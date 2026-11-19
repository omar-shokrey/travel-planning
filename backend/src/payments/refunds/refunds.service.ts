import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { NotificationLinkType } from '../../notifications/enums/notification-link-type.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { BookingType } from '../enums/booking-type.enum';
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
import { REFUND_NOT_FOUND_MESSAGE } from './refunds.constants';

const MONGO_DUPLICATE_KEY = 11000;

/** What a cancellation (FLT-26, HTL-21, FLT-06) or a late payment asks for. */
export interface RefundRequest {
  bookingType: BookingType;
  bookingId: string;
  /** Whole, 0 to 100. The caller computes it (refundPercentFor, or 100). */
  refundPercent: number;
  reason: RefundReason;
}

const LINK_TYPE: Record<BookingType, NotificationLinkType> = {
  [BookingType.Flight]: NotificationLinkType.FlightBooking,
  [BookingType.Hotel]: NotificationLinkType.HotelBooking,
};

/** The idempotency key of a booking's refund: one per booking, at Stripe too. */
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
  ) {}

  /**
   * PAY-03: refunds `refundPercent` of a booking's succeeded payment.
   *
   * - 0% or an amount that rounds to 0: nothing is created, sent or notified;
   *   returns `null` (only a positive refund amount is refunded).
   * - No succeeded payment: 404 "Payment not found".
   * - The refund is recorded first (`pending`), then sent to Stripe. A booking
   *   has at most one refund: a second call returns the first one unchanged,
   *   so a retried cancellation is harmless.
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

    const payment = await this.payments
      .findOne({
        bookingType,
        bookingId: new Types.ObjectId(bookingId),
        status: PaymentStatus.Succeeded,
      })
      .lean()
      .exec();
    if (!payment) {
      throw new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE);
    }
    // Whole minor units, never more than the payment.
    const amount = Math.round((payment.amount * refundPercent) / 100);
    if (amount === 0) {
      return null;
    }

    let created: RefundSource;
    try {
      created = (
        await this.refunds.create({
          bookingType,
          bookingId: payment.bookingId,
          paymentId: payment._id,
          userId: payment.userId,
          amount,
          currency: payment.currency,
          refundPercent,
          reason,
          status: RefundStatus.Pending,
        })
      ).toObject();
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      // Already refunded (a retried cancellation, or two at the same moment).
      const existing = await this.refunds
        .findOne({ bookingType, bookingId: payment.bookingId })
        .lean()
        .orFail()
        .exec();
      return toRefundResponse(existing);
    }

    const sent = await this.submit(created, payment.stripePaymentIntentId);
    await this.notify(sent, true);
    return toRefundResponse(sent);
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
  private async notify(refund: RefundSource, first: boolean): Promise<void> {
    await this.notifications.notify(
      refund.userId,
      NotificationType.Refund,
      refundMessage(refund, first),
      { type: LINK_TYPE[refund.bookingType], id: refund.bookingId.toString() },
    );
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
