import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { FlightBookingStatus } from '../../flight-bookings/enums/flight-booking-status.enum';
import { HotelBookingStatus } from '../../hotel-bookings/enums/hotel-booking-status.enum';
import {
  BOOKING_KINDS,
  BookingType,
} from '../../payments/enums/booking-type.enum';
import {
  ADMIN_BOOKING_STATUSES,
  BOOKING_RANGE_ORDER_MESSAGE,
} from '../admin-bookings.constants';
import { ListAdminBookingsQueryDto } from './list-admin-bookings-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ListAdminBookingsQueryDto,
};

const parse = (
  query: Record<string, unknown>,
): Promise<ListAdminBookingsQueryDto> =>
  pipe.transform(query, metadata) as Promise<ListAdminBookingsQueryDto>;

/** The errors of the pipe, by field. Empty when the query is valid. */
async function errorsOf(query: Record<string, unknown>): Promise<FieldError[]> {
  try {
    await parse(query);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const invalidFields = async (query: Record<string, unknown>) =>
  (await errorsOf(query)).map(({ field }) => field).sort();

describe('ListAdminBookingsQueryDto (ACC-17)', () => {
  it('lists the first page of 10 with no filter by default', async () => {
    const dto = await parse({});

    expect(dto).toBeInstanceOf(ListAdminBookingsQueryDto);
    expect(dto).toMatchObject({ page: 1, limit: 10 });
    expect(dto.skip).toBe(0);
    expect(dto.type).toBeUndefined();
    expect(dto.status).toBeUndefined();
    expect(dto.from).toBeUndefined();
    expect(dto.to).toBeUndefined();
  });

  it('reads every filter from the query string', async () => {
    const dto = await parse({
      page: '3',
      limit: '20',
      type: 'hotel',
      status: 'expired',
      from: '2026-11-01',
      to: '2026-11-30',
    });

    expect(dto).toMatchObject({
      page: 3,
      limit: 20,
      type: BookingType.Hotel,
      status: 'expired',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(dto.skip).toBe(40);
  });

  it.each([
    ['type', { type: 'flight' }],
    ['status', { status: 'pending_payment' }],
    ['from', { from: '2026-11-01' }],
    ['to', { to: '2026-11-30' }],
  ])('accepts %s alone', async (_name, query) => {
    expect(await invalidFields(query)).toEqual([]);
  });

  it.each(BOOKING_KINDS)('accepts type %s', async (type) => {
    expect(await invalidFields({ type })).toEqual([]);
  });

  it('rejects type flight_change: a flight change is not a booking (FLT-27)', async () => {
    expect(await errorsOf({ type: BookingType.FlightChange })).toEqual([
      {
        field: 'type',
        messages: ['type must be one of the following values: flight, hotel'],
      },
    ]);
  });

  it.each(ADMIN_BOOKING_STATUSES)('accepts status %s', async (status) => {
    expect(await invalidFields({ status })).toEqual([]);
  });

  it('accepts from equal to to (one whole day)', async () => {
    expect(
      await invalidFields({ from: '2026-11-05', to: '2026-11-05' }),
    ).toEqual([]);
  });

  it('rejects from after to with a message naming both fields', async () => {
    const errors = await errorsOf({ from: '2026-11-06', to: '2026-11-05' });

    expect(errors).toEqual([
      { field: 'from', messages: [BOOKING_RANGE_ORDER_MESSAGE] },
    ]);
    expect(BOOKING_RANGE_ORDER_MESSAGE).toMatch(/\bfrom\b.*\bto\b/);
  });

  it.each([
    ['a type that does not exist', { type: 'car' }, ['type']],
    ['a status that does not exist', { status: 'paid' }, ['status']],
    ['a day that does not exist', { from: '2026-02-30' }, ['from']],
    ['a month that does not exist', { to: '2026-13-01' }, ['to']],
    ['a date without leading zeros', { from: '2026-1-5' }, ['from']],
    ['a date with a time', { to: '2026-01-05T10:00:00Z' }, ['to']],
    ['two types', { type: ['flight', 'hotel'] }, ['type']],
    ['a page size over 50', { limit: '51' }, ['limit']],
    ['page 0', { page: '0' }, ['page']],
    ['a parameter that is not allowed', { userId: 'x' }, ['userId']],
    ['a skip sent by the client', { skip: '5' }, ['skip']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_name, query, fields) => {
      expect(await invalidFields(query)).toEqual(fields);
    },
  );

  it('uses one set of statuses for flight and hotel bookings (GEN-11)', () => {
    expect(Object.values(HotelBookingStatus).sort()).toEqual(
      Object.values(FlightBookingStatus).sort(),
    );
    expect([...ADMIN_BOOKING_STATUSES].sort()).toEqual(
      Object.values(HotelBookingStatus).sort(),
    );
  });
});
