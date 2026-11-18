import { Mongoose } from 'mongoose';
import { HotelPolicy, HotelPolicySchema } from './hotel-policy.schema';

// Validation runs in memory: no database is opened.
const PolicyModel = new Mongoose().model(HotelPolicy.name, HotelPolicySchema);

const policy = (fields: Record<string, unknown> = {}) =>
  new PolicyModel({
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
    ...fields,
  });

const invalidPaths = (doc: ReturnType<typeof policy>): string[] =>
  Object.keys(doc.validateSync()?.errors ?? {}).sort();

describe('HotelPolicySchema (HTL-09, HTL-10)', () => {
  it('accepts two HH:mm times and tiers at the limits', () => {
    expect(policy().validateSync()).toBeUndefined();
  });

  it('gives a policy without tiers an empty list, which means no refund', () => {
    expect(policy({ cancellationTiers: undefined }).cancellationTiers).toEqual(
      [],
    );
  });

  it('requires both times', () => {
    expect(
      invalidPaths(policy({ checkInTime: undefined, checkOutTime: undefined })),
    ).toEqual(['checkInTime', 'checkOutTime']);
  });

  it.each(['24:00', '9:00', '14:60', '2pm'])('refuses the time %s', (time) => {
    expect(invalidPaths(policy({ checkInTime: time }))).toEqual([
      'checkInTime',
    ]);
  });

  it.each([
    ['a negative threshold', { daysBefore: -1, refundPercent: 50 }],
    ['a threshold that is not whole', { daysBefore: 1.5, refundPercent: 50 }],
    ['a refund above 100', { daysBefore: 7, refundPercent: 101 }],
    ['a negative refund', { daysBefore: 7, refundPercent: -1 }],
    ['a refund that is not whole', { daysBefore: 7, refundPercent: 12.5 }],
  ])('refuses a tier with %s', (_, tier) => {
    expect(invalidPaths(policy({ cancellationTiers: [tier] }))).toHaveLength(1);
  });

  it('refuses a tier without its numbers', () => {
    expect(invalidPaths(policy({ cancellationTiers: [{}] }))).toEqual([
      'cancellationTiers.0.daysBefore',
      'cancellationTiers.0.refundPercent',
    ]);
  });
});
