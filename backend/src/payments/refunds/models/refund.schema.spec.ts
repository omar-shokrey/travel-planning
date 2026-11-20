import { Mongoose, Types } from 'mongoose';
import { BookingType } from '../../enums/booking-type.enum';
import { RefundReason } from '../enums/refund-reason.enum';
import { RefundStatus } from '../enums/refund-status.enum';
import { Refund, RefundSchema } from './refund.schema';

// Validation runs in memory: no database is opened.
const RefundModel = new Mongoose().model(Refund.name, RefundSchema);

const valid = (fields: Record<string, unknown> = {}) => ({
  bookingType: BookingType.Hotel,
  bookingId: new Types.ObjectId(),
  paymentId: new Types.ObjectId(),
  userId: new Types.ObjectId(),
  amount: 12550,
  currency: 'USD',
  refundPercent: 50,
  reason: RefundReason.UserCancellation,
  ...fields,
});

async function invalidPaths(
  fields: Record<string, unknown>,
): Promise<string[]> {
  const error = (await new RefundModel(fields)
    .validate()
    .catch((caught: unknown) => caught)) as
    { errors?: Record<string, unknown> } | undefined;
  return Object.keys(error?.errors ?? {}).sort();
}

describe('Refund schema (PAY-03)', () => {
  it('is stored in the refunds collection and starts pending without a Stripe id', async () => {
    const doc = new RefundModel(valid());

    expect(RefundModel.collection.collectionName).toBe('refunds');
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.status).toBe(RefundStatus.Pending);
    expect(doc.toObject()).not.toHaveProperty('stripeRefundId');
  });

  it('requires every field except the status and the Stripe id', async () => {
    expect(await invalidPaths({})).toEqual([
      'amount',
      'bookingId',
      'bookingType',
      'currency',
      'paymentId',
      'reason',
      'refundPercent',
      'userId',
    ]);
  });

  it('stores the enums as text limited to their values', async () => {
    for (const path of ['bookingType', 'reason', 'status']) {
      expect(RefundSchema.path(path).options).toMatchObject({ type: String });
    }
    expect(await invalidPaths(valid({ reason: 'goodwill' }))).toEqual([
      'reason',
    ]);
    expect(await invalidPaths(valid({ status: 'partial' }))).toEqual([
      'status',
    ]);
    for (const reason of Object.values(RefundReason)) {
      expect(await invalidPaths(valid({ reason }))).toEqual([]);
    }
  });

  it('keeps the amount whole and at least 1, and the percent whole from 1 to 100', async () => {
    expect(await invalidPaths(valid({ amount: 0 }))).toEqual(['amount']);
    expect(await invalidPaths(valid({ amount: 10.5 }))).toEqual(['amount']);
    expect(await invalidPaths(valid({ refundPercent: 0 }))).toEqual([
      'refundPercent',
    ]);
    expect(await invalidPaths(valid({ refundPercent: 101 }))).toEqual([
      'refundPercent',
    ]);
    expect(await invalidPaths(valid({ refundPercent: 33.3 }))).toEqual([
      'refundPercent',
    ]);
  });

  it('has the unique booking index, the sparse Stripe id index and the recovery index', () => {
    expect(RefundSchema.indexes()).toEqual([
      [
        { bookingType: 1, bookingId: 1 },
        expect.objectContaining({ unique: true }),
      ],
      [
        { stripeRefundId: 1 },
        expect.objectContaining({ unique: true, sparse: true }),
      ],
      [{ status: 1, createdAt: 1 }, expect.anything()],
    ]);
  });
});
