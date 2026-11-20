import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { BookingType } from '../enums/booking-type.enum';
import { CreatePaymentDto } from './create-payment.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: CreatePaymentDto };
const ID = '6740f1c2a4b5c6d7e8f90789';

async function errorsOf(body: unknown): Promise<FieldError[]> {
  try {
    await pipe.transform(body, metadata);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('CreatePaymentDto (PAY-01)', () => {
  it.each(Object.values(BookingType))('accepts a %s payment', async (type) => {
    const dto = (await pipe.transform(
      { bookingType: type, bookingId: ID },
      metadata,
    )) as CreatePaymentDto;

    expect(dto).toBeInstanceOf(CreatePaymentDto);
    expect(dto).toEqual({ bookingType: type, bookingId: ID });
  });

  it('refuses another booking type', async () => {
    expect(await errorsOf({ bookingType: 'car', bookingId: ID })).toEqual([
      {
        field: 'bookingType',
        messages: ['bookingType must be one of: flight, hotel, flight_change'],
      },
    ]);
  });

  it('refuses an id that is not an id, and a missing body', async () => {
    expect(await errorsOf({ bookingType: 'flight', bookingId: 'abc' })).toEqual(
      [{ field: 'bookingId', messages: ['bookingId must be a valid id'] }],
    );
    expect(await errorsOf({})).toHaveLength(2);
  });

  it.each(['amount', 'currency', 'status', 'userId', 'stripePaymentIntentId'])(
    'refuses %s: the client never sets the amount, the owner or the payment state',
    async (field) => {
      const errors = await errorsOf({
        bookingType: 'flight',
        bookingId: ID,
        [field]: 1,
      });

      expect(errors.map((error) => error.field)).toEqual([field]);
    },
  );
});
