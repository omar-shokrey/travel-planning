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
    policyAcceptedAt: new Date('2026-11-17T18:00:00.000Z'),
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

  it('requires the moment the policies were accepted (PAY-02)', () => {
    expect(invalidPaths(booking({ policyAcceptedAt: undefined }))).toEqual([
      'policyAcceptedAt',
    ]);
  });

  it('has the indexes of the data model', () => {
    const indexes = HotelBookingSchema.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { reference: 1 },
          expect.objectContaining({ unique: true, sparse: true }),
        ],
        [{ userId: 1, status: 1 }, expect.anything()],
        [{ hotelId: 1, status: 1 }, expect.anything()],
        [{ status: 1, holdExpiresAt: 1 }, expect.anything()],
      ]),
    );
  });
});
