import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { PLATFORM_CURRENCY } from '../common/constants/currency';
import { BookingPoliciesService } from './booking-policies.service';
import type { CreatePaymentDto } from './dto/create-payment.dto';
import type {
  PaymentIntentResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';
import { BookingType } from './enums/booking-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import {
  FLIGHT_CHANGE_PAYMENT_PORT,
  type FlightChangePaymentPort,
} from './flight-change-payment-port';
import {
  toPaymentIntentResponse,
  toPaymentResponse,
  type PaymentSource,
} from './mappers/payment.mapper';
import { Payment } from './models/payment.schema';
import {
  ALREADY_PAID_MESSAGE,
  BOOKING_NOT_FOUND_MESSAGE,
  PAYMENT_CANCELLED_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  PAYMENT_NOT_FOUND_MESSAGE,
  PAYMENT_UNAVAILABLE_MESSAGE,
} from './payments.constants';
import { StripeGateway, type GatewayIntent } from './stripe.gateway';

const MONGO_DUPLICATE_KEY = 11000;

/** Stripe keeps an idempotency key for a day; the hold is 10 minutes. */
const idempotencyKeyOf = (type: BookingType, bookingId: string): string =>
  `payment-${type}-${bookingId}`;

/** A unique-index violation: another request created the same payment first. */
const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  error.code === MONGO_DUPLICATE_KEY;

/** What may be charged, whoever owns the payable thing. */
interface Payable {
  /** Minor units of `currency`. */
  amount: number;
  currency: string;
  holdExpiresAt: Date;
}

/**
 * PAY-01: paying a booking with Stripe (test mode). The frontend confirms the
 * PaymentIntent with Stripe Elements, so card details never reach the backend.
 * The booking is NOT confirmed here: only the webhook, after Stripe says the
 * money arrived, confirms it (`StripeWebhookService`).
 *
 * Only the Stripe payment id, the amount, the currency and the status are
 * stored. The client secret is read from Stripe whenever it is needed.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly policies: BookingPoliciesService,
    private readonly gateway: StripeGateway,
    // FLT-27: provided by the flight-bookings module; absent until it is.
    @Optional()
    @Inject(FLIGHT_CHANGE_PAYMENT_PORT)
    private readonly flightChanges?: FlightChangePaymentPort,
  ) {}

  /**
   * Starts the payment of the user's own booking. The booking must wait for
   * payment, have a live hold and have its policies accepted
   * (`BookingPoliciesService.findPayableOrThrow`); otherwise 404 or 409 and
   * Stripe is not called. The amount and the currency are the booking's, never
   * the client's. A booking has one payment: asking again returns the same
   * PaymentIntent while it waits for the card, and 409 once it succeeded,
   * failed (use the retry) or was cancelled. A flight change (FLT-27) is paid
   * the same way; its amount is the fare difference the flight change port
   * gives (`findPayable`).
   */
  async start(
    userId: string,
    dto: CreatePaymentDto,
  ): Promise<PaymentIntentResponseDto> {
    const payable = await this.findPayableOrThrow(
      dto.bookingType,
      dto.bookingId,
      userId,
      new Date(),
    );
    const existing = await this.findForBooking(dto.bookingType, dto.bookingId);
    if (existing) {
      return this.reopen(existing);
    }

    const intent = await this.gateway.createPaymentIntent(
      {
        amount: payable.amount,
        currency: payable.currency,
        bookingType: dto.bookingType,
        bookingId: dto.bookingId,
      },
      idempotencyKeyOf(dto.bookingType, dto.bookingId),
    );
    let created: PaymentSource;
    try {
      const document = await this.payments.create({
        bookingType: dto.bookingType,
        bookingId: new Types.ObjectId(dto.bookingId),
        userId: new Types.ObjectId(userId),
        stripePaymentIntentId: intent.id,
        amount: payable.amount,
        currency: payable.currency,
        status: PaymentStatus.RequiresPayment,
        holdExpiresAt: payable.holdExpiresAt,
      });
      created = document.toObject();
    } catch (error) {
      if (!isDuplicateKey(error)) {
        throw error;
      }
      // A request at the same moment created it first; Stripe returned the same intent to both.
      const winner = await this.findForBooking(dto.bookingType, dto.bookingId);
      if (!winner) {
        throw error;
      }
      return this.reopen(winner);
    }
    return toPaymentIntentResponse(created, secretOf(intent));
  }

  /**
   * Retries a payment that failed: it moves back to `requires_payment` and
   * returns the same PaymentIntent, so the user can confirm it again until the
   * hold ends. The booking must still be payable (live hold, accepted
   * policies). 409 when the payment already succeeded or was cancelled. A
   * payment that is still waiting for the card is returned as it is.
   */
  async retry(id: string, userId: string): Promise<PaymentIntentResponseDto> {
    const payment = await this.findOwnedOrThrow(id, userId);
    assertNotFinal(payment.status);
    await this.findPayableOrThrow(
      payment.bookingType,
      payment.bookingId.toString(),
      userId,
      new Date(),
    );

    const intent = await this.gateway.retrievePaymentIntent(
      payment.stripePaymentIntentId,
    );
    if (intent.status === 'succeeded') {
      // Stripe has the money; the webhook is about to confirm the booking.
      throw new ConflictException(ALREADY_PAID_MESSAGE);
    }
    if (intent.status === 'canceled') {
      throw new ConflictException(PAYMENT_CANCELLED_MESSAGE);
    }

    let current: PaymentSource = payment;
    if (payment.status === PaymentStatus.Failed) {
      const reopened = await this.payments
        .findOneAndUpdate(
          { _id: payment._id, status: PaymentStatus.Failed },
          { $set: { status: PaymentStatus.RequiresPayment } },
          { returnDocument: 'after' },
        )
        .lean()
        .exec();
      // Null: another request retried it first, so read it again.
      current = reopened ?? (await this.findOwnedOrThrow(id, userId));
      assertNotFinal(current.status);
    }
    return toPaymentIntentResponse(current, secretOf(intent));
  }

  /** The user's own payment (404 for a missing one or someone else's, ACC-11). */
  async findOne(id: string, userId: string): Promise<PaymentResponseDto> {
    return toPaymentResponse(await this.findOwnedOrThrow(id, userId));
  }

  /**
   * PAY-02 for a booking, the flight change port for a change (FLT-27). The
   * amount never comes from the client. Without the port, a change is 404
   * "Booking not found", as a missing booking is.
   */
  private async findPayableOrThrow(
    type: BookingType,
    id: string,
    userId: string,
    now: Date,
  ): Promise<Payable> {
    if (type !== BookingType.FlightChange) {
      const booking = await this.policies.findPayableOrThrow(
        type,
        id,
        userId,
        now,
      );
      return {
        amount: booking.total,
        currency: booking.currency,
        holdExpiresAt: booking.holdExpiresAt,
      };
    }
    if (!this.flightChanges) {
      throw new NotFoundException(BOOKING_NOT_FOUND_MESSAGE);
    }
    const change = await this.flightChanges.findPayable(id, userId, now);
    // A wrong answer is a programming error in the port: never store it or
    // send it to Stripe.
    if (!Number.isInteger(change.amount) || change.amount < 1) {
      throw new Error(
        `Flight change ${id}: the amount to pay must be a whole number of at least 1, got ${change.amount}`,
      );
    }
    if (change.currency !== PLATFORM_CURRENCY) {
      throw new Error(
        `Flight change ${id}: the currency must be ${PLATFORM_CURRENCY} (PAY-04), got ${change.currency}`,
      );
    }
    if (
      !(change.holdExpiresAt instanceof Date) ||
      !(change.holdExpiresAt.getTime() > now.getTime())
    ) {
      throw new Error(
        `Flight change ${id}: the port gave a hold that is not live`,
      );
    }
    return {
      amount: change.amount,
      currency: change.currency,
      holdExpiresAt: change.holdExpiresAt,
    };
  }

  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<PaymentSource> {
    const payment = await this.payments
      .findOne({ _id: id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();
    if (!payment) {
      throw new NotFoundException(PAYMENT_NOT_FOUND_MESSAGE);
    }
    return payment;
  }

  private findForBooking(
    type: BookingType,
    bookingId: string,
  ): Promise<PaymentSource | null> {
    return this.payments
      .findOne({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .lean()
      .exec();
  }

  /** What a second request to pay the same booking gets, by the payment's status. */
  private async reopen(
    payment: PaymentSource,
  ): Promise<PaymentIntentResponseDto> {
    if (payment.status === PaymentStatus.Failed) {
      throw new ConflictException(PAYMENT_FAILED_MESSAGE);
    }
    assertNotFinal(payment.status);
    const intent = await this.gateway.retrievePaymentIntent(
      payment.stripePaymentIntentId,
    );
    return toPaymentIntentResponse(payment, secretOf(intent));
  }
}

/** 409 for a payment that is over: it succeeded, or it was cancelled. */
function assertNotFinal(status: PaymentStatus): void {
  if (status === PaymentStatus.Succeeded) {
    throw new ConflictException(ALREADY_PAID_MESSAGE);
  }
  if (status === PaymentStatus.Cancelled) {
    throw new ConflictException(PAYMENT_CANCELLED_MESSAGE);
  }
}

function secretOf(intent: GatewayIntent): string {
  if (!intent.clientSecret) {
    // Stripe returned an intent that cannot be confirmed in the browser.
    throw new BadGatewayException(PAYMENT_UNAVAILABLE_MESSAGE);
  }
  return intent.clientSecret;
}
