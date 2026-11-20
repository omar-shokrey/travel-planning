import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { NotificationLinkType } from '../../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import {
  type NotificationLink,
  NotificationsService,
} from '../../notifications/notifications.service';
import { type BookingKind, BookingType } from '../enums/booking-type.enum';
import {
  FLIGHT_CHANGE_PAYMENT_PORT,
  type FlightChangePaymentPort,
} from '../flight-change-payment-port';
import { PaymentStatus } from '../enums/payment-status.enum';
import { Payment } from '../models/payment.schema';
import { PAYMENT_NOT_FOUND_MESSAGE } from '../payments.constants';
import { StripeGateway } from '../stripe.gateway';
import type {
  RefundResponseDto,
  RefundSummaryDto,
} from './dto/refund-response.dto';
import type { RefundReason } from './enums/refund-reason.enum';
import { RefundStatus } from './enums/refund-status.enum';
import {
  type RefundSource,
  toRefundResponse,
  toRefundSummary,
} from './mappers/refund.mapper';
import { Refund } from './models/refund.schema';
import { refundMessage } from './refund-messages';
import { refundStatusOf } from './refund-status';
import {
  REFUND_BUSY_MESSAGE,
  REFUND_CLAIM_ATTEMPTS,
  REFUND_EXCEEDS_PAYMENT_MESSAGE,
  REFUND_NOT_FOUND_MESSAGE,
} from './refunds.constants';

const MONGO_DUPLICATE_KEY = 11000;

/** What a cancellation (FLT-26, HTL-21, FLT-06) or a late payment asks for. */
export interface RefundRequest {
  bookingType: BookingType;
  bookingId: string;
  /**
   * Whole, 0 to 100, of what is left of the payment (its amount minus the
   * refunds already made against it). The caller computes it
   * (refundPercentFor, or 100).
   */
  refundPercent: number;
  reason: RefundReason;
}

/** The booking a refund's notification links to. */
export interface RefundLink {
  bookingType: BookingKind;
  bookingId: string;
}

/**
 * An exact amount to refund (FLT-27: the fare difference of a cheaper
 * flight). The refund is keyed on (`bookingType`, `bookingId`) and paid back
 * from the succeeded payment of `paymentOf`.
 */
export interface AmountRefundRequest {
  bookingType: BookingType;
  bookingId: string;
  paymentOf: { bookingType: BookingType; bookingId: string };
  /** Whole minor units of the payment's currency. */
  amount: number;
  reason: RefundReason;
  /** Where the first notification links; otherwise worked out from the refund. */
  link?: RefundLink;
}

const LINK_TYPE: Record<BookingKind, NotificationLinkType> = {
  [BookingType.Flight]: NotificationLinkType.FlightBooking,
  [BookingType.Hotel]: NotificationLinkType.HotelBooking,
};

/** The fields of a payment the refunds need, with its version for the claim. */
interface ClaimablePayment {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  stripePaymentIntentId: string;
  amount: number;
  currency: string;
  __v?: number;
}

/** What `record` did: recorded a new refund, found one, or nothing to refund. */
type RecordResult =
  | { kind: 'created'; refund: RefundSource; payment: ClaimablePayment }
  | { kind: 'existing'; refund: RefundSource }
  | { kind: 'nothing' };

/** The idempotency key of a refund: one per (`bookingType`, `bookingId`), at Stripe too. */
export const refundIdempotencyKey = (
  bookingType: BookingType,
  bookingId: Types.ObjectId | string,
): string => `refund-${bookingType}-${bookingId.toString()}`;

/**
 * PAY-03: refunds through Stripe. It reads only payments and refunds, never a
 * booking or a tier, so the booking modules can import it without a cycle
 * (development plan, section 15).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly gateway: StripeGateway,
    private readonly notifications: NotificationsService,
    // FLT-27: finds the flight change port, which the flight-bookings module
    // provides. That module imports this one, so the port cannot be injected
    // here; it is looked up when a flight change's refund is notified.
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * PAY-03: refunds `refundPercent` of what is left of a booking's succeeded
   * payment: its amount minus the refunds already made against it (pending or
   * refunded, never failed; FLT-27 refunds a cheaper fare from the same
   * payment). With no earlier refund that is the whole payment, as before.
   *
   * - 0% or an amount that rounds to 0: nothing is created, sent or notified;
   *   returns `null` (only a positive refund amount is refunded).
   * - No succeeded payment: 404 "Payment not found".
   * - The refund is recorded first (`pending`), then sent to Stripe. One
   *   (`bookingType`, `bookingId`) has at most one refund: a second call
   *   returns the first one unchanged, so a retried cancellation is harmless.
   * - Refunds of the same payment at the same moment never add up to more
   *   than it (see `record`); after REFUND_CLAIM_ATTEMPTS lost claims the
   *   answer is 409 and nothing is recorded.
   * - If Stripe is unavailable the refund stays `pending` without a Stripe id
   *   and this method still answers: a cancellation never fails because of
   *   Stripe. The recovery job sends it later.
   * - The owner is notified once the refund is recorded.
   */
  async refund(request: RefundRequest): Promise<RefundResponseDto | null> {
    const { bookingType, bookingId, refundPercent, reason } = request;
    if (
      !Number.isInteger(refundPercent) ||
      refundPercent < 0 ||
      refundPercent > 100
    ) {
      throw new RangeError(
        `refundPercent must be a whole number from 0 to 100: ${refundPercent}`,
      );
    }
    if (refundPercent === 0) {
      return null;
    }

    const recorded = await this.record(
      () =>
        this.payments
          .findOne({
            bookingType,
            bookingId: new Types.ObjectId(bookingId),
            status: PaymentStatus.Succeeded,
          })
          .lean()
          .exec(),
      { bookingType, bookingId },
      reason,
      (_payment, remaining) => {
        // Whole minor units, never more than what is left of the payment.
        const amount = Math.round((remaining * refundPercent) / 100);
        return amount > 0 ? { amount, refundPercent } : null;
      },
    );
    if (recorded.kind === 'nothing') {
      return null;
    }
    if (recorded.kind === 'existing') {
      return toRefundResponse(recorded.refund);
    }
    const { refund: created, payment } = recorded;
    const sent = await this.submit(created, payment.stripePaymentIntentId);
    await this.notify(sent, true);
    return toRefundResponse(sent);
  }

  /**
   * FLT-27: refunds an exact `amount` (whole minor units) from the succeeded
   * payment of `paymentOf`, keyed on (`bookingType`, `bookingId`).
   *
   * - Idempotent: a refund with the same key already recorded is returned
   *   unchanged (Stripe and the notification once in total).
   * - 0 creates nothing and returns `null`.
   * - No succeeded payment: 404 "Payment not found". More than what is left
   *   of the payment (also when another refund of it is made at the same
   *   moment), or too many lost claims: 409, and nothing is recorded.
   * - Recorded first (`pending`), then sent to Stripe with an idempotency key
   *   of its own key; Stripe trouble leaves it `pending` for the recovery job
   *   and never throws.
   * - `refundPercent` is the share of the payment, rounded, from 1 to 100.
   * - The owner is notified once it is recorded, linked to `link` when given.
   */
  async refundAmount(
    request: AmountRefundRequest,
  ): Promise<RefundResponseDto | null> {
    const { bookingType, bookingId, paymentOf, amount, reason, link } = request;
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(
        `amount must be a whole number of minor units, 0 or more: ${amount}`,
      );
    }
    if (amount === 0) {
      return null;
    }
    const key = { bookingType, bookingId: new Types.ObjectId(bookingId) };
    const already = await this.refunds.findOne(key).lean().exec();
    if (already) {
      return toRefundResponse(already);
    }

    const recorded = await this.record(
      () =>
        this.payments
          .findOne({
            bookingType: paymentOf.bookingType,
            bookingId: new Types.ObjectId(paymentOf.bookingId),
            status: PaymentStatus.Succeeded,
          })
          .lean()
          .exec(),
      { bookingType, bookingId },
      reason,
      (payment, remaining) => {
        if (amount > remaining) {
          throw new ConflictException(REFUND_EXCEEDS_PAYMENT_MESSAGE);
        }
        return { amount, refundPercent: percentOf(amount, payment.amount) };
      },
    );
    if (recorded.kind !== 'created') {
      // Never `nothing`: the amount is positive and checked against the rest.
      return recorded.kind === 'existing'
        ? toRefundResponse(recorded.refund)
        : null;
    }
    const { refund: created, payment } = recorded;
    const sent = await this.submit(created, payment.stripePaymentIntentId);
    await this.notify(sent, true, link);
    return toRefundResponse(sent);
  }

  /**
   * What was already refunded from a payment: every refund against it that is
   * pending or refunded (a failed one gave nothing back), except the refund
   * with the key being asked for, which is the same refund asked again.
   */
  private async refundedFrom(
    paymentId: Types.ObjectId,
    bookingType: BookingType,
    bookingId: string,
  ): Promise<number> {
    const earlier = await this.refunds
      .find({ paymentId, status: { $ne: RefundStatus.Failed } })
      .select('bookingType bookingId amount')
      .lean()
      .exec();
    return earlier
      .filter(
        (refund) =>
          refund.bookingType !== bookingType ||
          refund.bookingId.toString() !== bookingId,
      )
      .reduce((sum, refund) => sum + refund.amount, 0);
  }

  /**
   * Records a refund against a payment, never more than what is left of it,
   * even when several refunds of the same payment are made at the same moment.
   *
   * Each attempt reads the payment (with its version, `__v`), then the refunds
   * already made against it, works out the amount (`plan`), records the refund
   * (or corrects the one this call recorded before), and finally claims the
   * payment: one conditional update that bumps `__v` only if it is still the
   * version read. A refund of the same payment that claimed it in between was
   * recorded before its claim, so this call sees it on its next attempt; the
   * loser of two claims at the same moment tries again with the new sum. So a
   * claimed refund always fits, and no index or field is needed. After
   * REFUND_CLAIM_ATTEMPTS lost claims the refund this call recorded is removed
   * (by id, before it reached Stripe) and the answer is 409.
   *
   * A refund with the same key already recorded is returned as `existing`;
   * `plan` returning `null` (nothing to refund) is `nothing`; `plan` may throw
   * (409 above the rest), and the refund this call recorded is then removed.
   */
  private async record(
    findPayment: () => Promise<ClaimablePayment | null>,
    key: { bookingType: BookingType; bookingId: string },
    reason: RefundReason,
    plan: (
      payment: ClaimablePayment,
      remaining: number,
    ) => { amount: number; refundPercent: number } | null,
  ): Promise<RecordResult> {
    let own: RefundSource | undefined;
    for (let attempt = 1; ; attempt += 1) {
      const payment = await findPayment();
      if (!payment) {
        await this.removeOwn(own);
        throw new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE);
      }
      const remaining =
        payment.amount -
        (await this.refundedFrom(payment._id, key.bookingType, key.bookingId));
      let planned: { amount: number; refundPercent: number } | null;
      try {
        planned = plan(payment, remaining);
      } catch (error) {
        await this.removeOwn(own);
        throw error;
      }
      if (!planned) {
        await this.removeOwn(own);
        return { kind: 'nothing' };
      }

      if (!own) {
        try {
          own = (
            await this.refunds.create({
              bookingType: key.bookingType,
              bookingId: new Types.ObjectId(key.bookingId),
              paymentId: payment._id,
              userId: payment.userId,
              amount: planned.amount,
              currency: payment.currency,
              refundPercent: planned.refundPercent,
              reason,
              status: RefundStatus.Pending,
            })
          ).toObject();
        } catch (error) {
          if (!isDuplicateKey(error)) {
            throw error;
          }
          // Already refunded (a retried call, or two at the same moment).
          const existing = await this.refunds
            .findOne({
              bookingType: key.bookingType,
              bookingId: new Types.ObjectId(key.bookingId),
            })
            .lean()
            .orFail()
            .exec();
          return { kind: 'existing', refund: existing };
        }
      } else if (
        own.amount !== planned.amount ||
        own.refundPercent !== planned.refundPercent
      ) {
        // Not sent yet: correct it to what is left now.
        await this.refunds
          .updateOne({ _id: own._id }, { $set: planned })
          .exec();
        own = { ...own, ...planned };
      }

      if (await this.claim(payment)) {
        return { kind: 'created', refund: own, payment };
      }
      if (attempt >= REFUND_CLAIM_ATTEMPTS) {
        await this.removeOwn(own);
        this.logger.warn(
          `Refund of ${key.bookingType} ${key.bookingId} gave up after ${attempt} claims of payment ${payment._id.toString()} by other refunds.`,
        );
        throw new ConflictException(REFUND_BUSY_MESSAGE);
      }
    }
  }

  /** One conditional update: the payment is still at the version read. */
  private async claim(payment: ClaimablePayment): Promise<boolean> {
    const { matchedCount } = await this.payments
      .updateOne(
        {
          _id: payment._id,
          __v: payment.__v ?? { $exists: false },
        },
        { $inc: { __v: 1 } },
        { timestamps: false },
      )
      .exec();
    return matchedCount > 0;
  }

  /** Removes, by id, a refund this call recorded and never sent. */
  private async removeOwn(own: RefundSource | undefined): Promise<void> {
    if (own) {
      await this.refunds.deleteOne({ _id: own._id }).exec();
    }
  }

  /**
   * Sends a recorded refund to Stripe, once: the idempotency key is the
   * booking's, so a retry (here or from the recovery job, within Stripe's 24
   * hours) gets the same Stripe refund. The Stripe id and status are stored
   * with one update that matches only a refund without a Stripe id yet.
   * Stripe trouble (502, 503) is logged and leaves the refund `pending`;
   * it never throws.
   */
  async submit(
    refund: RefundSource,
    paymentIntentId?: string,
  ): Promise<RefundSource> {
    const id = refund._id.toString();
    const intentId =
      paymentIntentId ??
      (
        await this.payments
          .findById(refund.paymentId)
          .select('stripePaymentIntentId')
          .lean()
          .orFail()
          .exec()
      ).stripePaymentIntentId;

    let stripeRefund;
    try {
      stripeRefund = await this.gateway.createRefund(
        {
          paymentIntentId: intentId,
          amount: refund.amount,
          metadata: {
            bookingType: refund.bookingType,
            bookingId: refund.bookingId.toString(),
          },
        },
        refundIdempotencyKey(refund.bookingType, refund.bookingId),
      );
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        // Never the Stripe error object or a key: only our message.
        this.logger.warn(
          `Refund ${id} could not be sent to Stripe yet (${error.message}); it stays pending and is sent again.`,
        );
        return refund;
      }
      throw error;
    }

    const updated = await this.refunds
      .findOneAndUpdate(
        { _id: refund._id, stripeRefundId: { $exists: false } },
        {
          $set: {
            stripeRefundId: stripeRefund.id,
            status: refundStatusOf(stripeRefund.status),
          },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    // Another run stored it first: read what it stored.
    return (
      updated ??
      (await this.refunds.findById(refund._id).lean().orFail().exec())
    );
  }

  /**
   * PAY-03 "show its status on the booking details": the refund of a booking,
   * or `null`. The booking details of FLT-25 and the hotel details call it.
   */
  async findSummaryByBooking(
    bookingType: BookingType,
    bookingId: string,
  ): Promise<RefundSummaryDto | null> {
    const refund = await this.refunds
      .findOne({ bookingType, bookingId: new Types.ObjectId(bookingId) })
      .lean()
      .exec();
    return refund ? toRefundSummary(refund) : null;
  }

  /**
   * PAY-03: GET /api/refunds/:id. Only the owner sees a refund: someone
   * else's refund or a missing one is the same 404 (ACC-11).
   */
  async findOwned(id: string, userId: string): Promise<RefundResponseDto> {
    const refund = await this.refunds
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!refund) {
      throw new NotFoundException(REFUND_NOT_FOUND_MESSAGE);
    }
    return toRefundResponse(refund);
  }

  /**
   * PAY-03: a refund.* webhook event. The refund moves only forward, from
   * `pending` to `refunded` or `failed`, with one conditional update; the
   * owner is notified only when that update really changed it. A refund
   * Stripe still reports as pending, or one already final, is left alone.
   * An unknown Stripe refund id is logged and ignored.
   */
  async applyStripeStatus(
    stripeRefundId: string,
    stripeStatus: string,
  ): Promise<void> {
    const status = refundStatusOf(stripeStatus);
    const refund = await this.refunds.findOne({ stripeRefundId }).lean().exec();
    if (!refund) {
      this.logger.warn(`Stripe reported an unknown refund ${stripeRefundId}`);
      return;
    }
    if (status === RefundStatus.Pending) {
      return;
    }
    const moved = await this.refunds
      .findOneAndUpdate(
        { _id: refund._id, status: RefundStatus.Pending },
        { $set: { status } },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (moved) {
      await this.notify(moved, false);
    }
  }

  /**
   * PAY-03, for the recovery job: sends again a refund Stripe could not take,
   * and tells the owner when Stripe's answer already settled it.
   */
  async resubmit(refund: RefundSource): Promise<RefundSource> {
    const sent = await this.submit(refund);
    if (sent.status !== refund.status) {
      await this.notify(sent, false);
    }
    return sent;
  }

  /** The in-app notification of a refund (GEN-01). `notify` never throws. */
  private async notify(
    refund: RefundSource,
    first: boolean,
    link?: RefundLink,
  ): Promise<void> {
    const target = link ?? (await this.linkOf(refund));
    const notificationLink: NotificationLink | undefined = target
      ? { type: LINK_TYPE[target.bookingType], id: target.bookingId }
      : undefined;
    await this.notifications.notify(
      refund.userId,
      NotificationType.Refund,
      refundMessage(refund, first),
      notificationLink,
    );
  }

  /**
   * The booking a refund is about. A flight change's refund (FLT-27) links to
   * its flight booking, which only the flight change port knows; without the
   * port, or when it fails, the notification is sent without a link.
   */
  private async linkOf(refund: RefundSource): Promise<RefundLink | null> {
    if (refund.bookingType !== BookingType.FlightChange) {
      return {
        bookingType: refund.bookingType,
        bookingId: refund.bookingId.toString(),
      };
    }
    const port = this.flightChangePort();
    if (!port) {
      return null;
    }
    try {
      return await port.linkOf(refund.bookingId.toString());
    } catch (error) {
      this.logger.warn(
        `The booking of flight change ${refund.bookingId.toString()} could not be found for its refund notification: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
  }

  private flightChangePort(): FlightChangePaymentPort | undefined {
    try {
      return this.moduleRef?.get<FlightChangePaymentPort>(
        FLIGHT_CHANGE_PAYMENT_PORT,
        { strict: false },
      );
    } catch {
      // Not provided (the flight-bookings module has no flight change yet).
      return undefined;
    }
  }
}

/** The share of a payment an amount is, rounded, from 1 to 100 (the schema's range). */
export function percentOf(amount: number, paymentAmount: number): number {
  return Math.min(100, Math.max(1, Math.round((amount * 100) / paymentAmount)));
}

function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
