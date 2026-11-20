import { model, Types } from 'mongoose';
import { HotelBookingStatus } from '../enums/hotel-booking-status.enum';
import { HotelBookingSchema } from './hotel-booking.schema';

// Validation runs in memory: no database is opened.
const HotelBookingModel = model('HotelBookingSchemaSpec', HotelBookingSchema);

const room = (fields: Record<string, unknown> = {}) => ({
  roomId: new Types.ObjectId(),
  roomLabel: '101 (Double)',
  pricePerNight: 12500,
  adults: 2,
  childAges: [7],
  ...fields,
});

const booking = (fields: Record<string, unknown> = {}) =>
  new HotelBookingModel({
    userId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    checkIn: '2026-12-10',
    checkOut: '2026-12-13',
    nights: 3,
    status: HotelBookingStatus.PendingPayment,
    holdExpiresAt: new Date('2026-11-17T18:10:00.000Z'),
    currency: 'USD',
    total: 37500,
    rooms: [room()],
    ...fields,
  });

const invalidPaths = (doc: ReturnType<typeof booking>): string[] =>
  Object.keys(doc.validateSync()?.errors ?? {});

describe('HotelBooking schema', () => {
  it('is stored in the hotel_bookings collection', () => {
    expect(HotelBookingModel.collection.collectionName).toBe('hotel_bookings');
  });

  it('accepts a pending reservation without times or tiers', () => {
    const doc = booking();

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.cancellationTiers).toEqual([]);
    expect(doc.reference).toBeUndefined();
  });

  it('has no policyAcceptedAt until the policies are accepted (PAY-02)', () => {
    const pending = booking();

    expect(pending.policyAcceptedAt).toBeUndefined();
    expect(pending.toObject()).not.toHaveProperty('policyAcceptedAt');
    expect(HotelBookingSchema.path('policyAcceptedAt').options).toMatchObject({
      type: Date,
    });
    expect(HotelBookingSchema.path('policyAcceptedAt').isRequired).toBeFalsy();

    const acceptedAt = new Date('2026-11-17T18:02:00.000Z');
    const accepted = booking({ policyAcceptedAt: acceptedAt });
    expect(accepted.validateSync()).toBeUndefined();
    expect(accepted.policyAcceptedAt).toEqual(acceptedAt);
  });

  it('accepts every status of GEN-11', () => {
    for (const status of Object.values(HotelBookingStatus)) {
      expect(booking({ status }).validateSync()).toBeUndefined();
    }
  });

  it('refuses an unknown status', () => {
    expect(invalidPaths(booking({ status: 'paid' }))).toEqual(['status']);
  });

  it('refuses a date with a time', () => {
    expect(
      invalidPaths(booking({ checkIn: '2026-12-10T00:00:00.000Z' })),
    ).toEqual(['checkIn']);
  });

  it('refuses a total that is not whole', () => {
    expect(invalidPaths(booking({ total: 10.5 }))).toEqual(['total']);
  });

  it('refuses a child older than 17', () => {
    expect(
      invalidPaths(booking({ rooms: [room({ childAges: [18] })] })),
    ).toEqual(['rooms.0.childAges']);
  });

  it('refuses a time that is not HH:mm', () => {
    expect(invalidPaths(booking({ checkInTime: '2pm' }))).toEqual([
      'checkInTime',
    ]);
  });

  it('has a unique, sparse index on the reference', () => {
    expect(HotelBookingSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { reference: 1 },
          expect.objectContaining({ unique: true, sparse: true }),
        ],
      ]),
    );
  });

  it('has the (status, checkOut) index of the completion job (GEN-11)', () => {
    expect(HotelBookingSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, checkOut: 1 }, {}]]),
    );
  });

  it('has the (status, holdExpiresAt) index of the hold-expiry job (HTL-18)', () => {
    expect(HotelBookingSchema.indexes()).toEqual(
      expect.arrayContaining([[{ status: 1, holdExpiresAt: 1 }, {}]]),
    );
  });

  it('has the (userId, status, checkIn) index of "My hotel reservations" (HTL-20)', () => {
    expect(HotelBookingSchema.indexes()).toEqual(
      expect.arrayContaining([[{ userId: 1, status: 1, checkIn: 1 }, {}]]),
    );
  });
});
