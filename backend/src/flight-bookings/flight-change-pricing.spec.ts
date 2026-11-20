import { PassengerType } from './enums/passenger-type.enum';
import {
  ageGroupsUnchanged,
  bagsFitRule,
  cancellationRefundOf,
  originalPaymentLeft,
  segmentPriceOf,
} from './flight-change-pricing';

const passenger = (
  type: PassengerType,
  dateOfBirth: string,
  baggage: { segment: number; bags: number; weightKg: number }[] = [],
) => ({
  fullName: 'Test Passenger',
  dateOfBirth,
  passportNumber: 'A1234567',
  type,
  baggage,
});

const booking = {
  passengerCounts: { adults: 1, children: 1, infants: 1 },
  passengers: [
    passenger(PassengerType.Adult, '1990-01-01', [
      { segment: 0, bags: 2, weightKg: 40 },
      { segment: 1, bags: 1, weightKg: 20 },
    ]),
    passenger(PassengerType.Child, '2018-06-15'),
    passenger(PassengerType.Infant, '2026-01-10'),
  ],
};

describe('segmentPriceOf (FLT-27)', () => {
  it('prices one segment: every seat, the infant at 10% rounded, and the bags on that segment only', () => {
    const segment = { fare: 10_005, seatsReserved: 2, extraBagPrice: 4500 };

    // 2 × 10005 + round(1000.5) = 21011; 2 bags × 4500 on segment 0.
    expect(segmentPriceOf(booking, segment, 0)).toEqual({
      fareTotal: 21_011,
      baggageTotal: 9000,
      total: 30_011,
    });
    expect(segmentPriceOf(booking, segment, 1)).toEqual({
      fareTotal: 21_011,
      baggageTotal: 4500,
      total: 25_511,
    });
  });

  it('counts no bag fee without a bag price, and no bags for a booking without passengers', () => {
    expect(
      segmentPriceOf(booking, { fare: 100, seatsReserved: 2 }, 0).baggageTotal,
    ).toBe(0);
    expect(
      segmentPriceOf(
        { passengerCounts: booking.passengerCounts, passengers: [] },
        { fare: 100, seatsReserved: 2, extraBagPrice: 4500 },
        0,
      ),
    ).toEqual({ fareTotal: 210, baggageTotal: 0, total: 210 });
  });
});

describe('bagsFitRule (FLT-27)', () => {
  const rule = { extraBagPrice: 4500, maxExtraBags: 2, maxBagKg: 23 };

  it('accepts the bags of that segment under the same rule as a booking', () => {
    expect(bagsFitRule(booking, 0, rule)).toBe(true);
    expect(bagsFitRule(booking, 1, { ...rule, maxExtraBags: 1 })).toBe(true);
  });

  it.each([
    ['an airline that sells no extra bags', { maxExtraBags: 0 }],
    ['fewer extra bags', { maxExtraBags: 1 }],
    ['lighter bags', { maxBagKg: 19 }],
  ])('refuses %s', (_name, change) => {
    expect(bagsFitRule(booking, 0, { ...rule, ...change })).toBe(false);
  });

  it('accepts any rule when nobody has extra bags on that segment', () => {
    expect(
      bagsFitRule(
        { passengers: [passenger(PassengerType.Adult, '1990-01-01')] },
        0,
        {
          maxExtraBags: 0,
        },
      ),
    ).toBe(true);
  });
});

describe('ageGroupsUnchanged (FLT-27, FLT-12)', () => {
  it('keeps every type on a new outbound date, and refuses a child who turns 12 or an infant who turns 2', () => {
    expect(ageGroupsUnchanged(booking, 0, '2026-12-01')).toBe(true);
    // The infant turns 2 on 2028-01-10.
    expect(ageGroupsUnchanged(booking, 0, '2028-01-10')).toBe(false);
    // The child turns 12 on 2030-06-15.
    expect(ageGroupsUnchanged(booking, 0, '2030-06-15')).toBe(false);
  });

  it('on a new return date only needs the infant to still be an infant', () => {
    expect(ageGroupsUnchanged(booking, 1, '2028-01-09')).toBe(true);
    expect(ageGroupsUnchanged(booking, 1, '2028-01-10')).toBe(false);
    // A child turning 12 on the way back keeps their seat: allowed.
    expect(
      ageGroupsUnchanged(
        { passengers: [passenger(PassengerType.Child, '2018-06-15')] },
        1,
        '2030-06-15',
      ),
    ).toBe(true);
  });
});

describe('originalPaymentLeft and cancellationRefundOf (FLT-27, FLT-26)', () => {
  it('is the total less the paid differences', () => {
    expect(originalPaymentLeft(30_000, [])).toBe(30_000);
    expect(originalPaymentLeft(30_000, [4000, 1000])).toBe(25_000);
  });

  it('refunds the percent of each payment, each rounded like PAY-03', () => {
    // Never changed: total × percent, rounded.
    expect(cancellationRefundOf(25_001, [], 50)).toBe(12_501);
    // round(25001 × 0.5) + round(3 × 0.5) + round(5 × 0.5) = 12501 + 2 + 3
    expect(cancellationRefundOf(25_009, [3, 5], 50)).toBe(12_506);
    expect(cancellationRefundOf(25_009, [3, 5], 100)).toBe(25_009);
    expect(cancellationRefundOf(25_009, [3, 5], 0)).toBe(0);
  });
});
