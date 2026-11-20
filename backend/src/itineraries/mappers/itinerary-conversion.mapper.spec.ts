import type { ItineraryDetailResponseDto } from '../dto/itinerary-detail-response.dto';
import { LinkedBookingType } from '../enums/linked-booking-type.enum';
import { withConvertedAmounts } from './itinerary-conversion.mapper';

const RATES = {
  rateDate: '2026-11-18',
  fetchedAt: new Date('2026-11-19T06:00:00.000Z'),
  rates: { USD: 1, EGP: 50, JPY: 150 },
};

/** An itinerary as the detail mapper gives it: two days, every kind of cost. */
const detail = (): ItineraryDetailResponseDto =>
  ({
    id: 'i1',
    days: [
      {
        id: 'd1',
        activities: [
          { id: 'a1', name: 'Museum', cost: 2000, currency: 'EGP', images: [] },
          { id: 'a2', name: 'Walk', images: [] },
        ],
        budgetEntries: [
          { id: 'b1', category: 'food', amount: 1500, currency: 'USD' },
        ],
        transportCosts: [],
        linkedBookings: [],
      },
      {
        id: 'd2',
        activities: [],
        budgetEntries: [
          { id: 'b2', category: 'food', amount: 999, currency: 'GBP' },
        ],
        transportCosts: [
          {
            id: 't1',
            mode: 'train',
            fromCityId: 'cairo',
            toCityId: 'luxor',
            amount: 30000,
            currency: 'EGP',
          },
        ],
        linkedBookings: [],
      },
    ],
    cityGroups: [
      {
        cityId: 'cairo',
        budgetSubtotal: [
          { amount: 2000, currency: 'EGP' },
          { amount: 1500, currency: 'USD' },
        ],
      },
      {
        cityId: 'luxor',
        budgetSubtotal: [
          { amount: 30000, currency: 'EGP' },
          { amount: 999, currency: 'GBP' },
        ],
      },
    ],
  }) as unknown as ItineraryDetailResponseDto;

describe('withConvertedAmounts (ITN-18)', () => {
  it('converts every budget amount and every city-group subtotal', () => {
    const result = withConvertedAmounts(detail(), {
      currency: 'USD',
      rates: RATES,
    });

    // EGP 20.00 = USD 0.40; EGP 300.00 = USD 6.00.
    expect(result.days[0].activities[0].converted).toEqual({
      amount: 40,
      currency: 'USD',
    });
    expect(result.days[0].budgetEntries[0].converted).toEqual({
      amount: 1500,
      currency: 'USD',
    });
    expect(result.days[1].transportCosts[0].converted).toEqual({
      amount: 600,
      currency: 'USD',
    });
    expect(result.cityGroups[0].budgetSubtotalConverted).toEqual({
      amount: 1540,
      currency: 'USD',
    });
  });

  it('leaves an activity without a cost as it is', () => {
    const result = withConvertedAmounts(detail(), {
      currency: 'USD',
      rates: RATES,
    });

    expect(result.days[0].activities[1]).toEqual({
      id: 'a2',
      name: 'Walk',
      images: [],
    });
  });

  it('gives null where a currency has no rate and names it', () => {
    const result = withConvertedAmounts(detail(), {
      currency: 'USD',
      rates: RATES,
    });

    expect(result.days[1].budgetEntries[0].converted).toBeNull();
    expect(result.cityGroups[1].budgetSubtotalConverted).toBeNull();
    expect(result.conversion).toEqual({
      currency: 'USD',
      rateDate: '2026-11-18',
      fetchedAt: '2026-11-19T06:00:00.000Z',
      missingCurrencies: ['GBP'],
    });
  });

  it('uses the decimal places of the target currency', () => {
    const result = withConvertedAmounts(detail(), {
      currency: 'JPY',
      rates: RATES,
    });

    // USD 15.00 = JPY 2,250.
    expect(result.days[0].budgetEntries[0].converted).toEqual({
      amount: 2250,
      currency: 'JPY',
    });
  });

  it('converts nothing without rates and keeps the amounts as entered', () => {
    const result = withConvertedAmounts(detail(), {
      currency: 'USD',
      rates: null,
    });

    expect(result.conversion).toBeNull();
    expect(result.days[0].budgetEntries[0]).toEqual({
      id: 'b1',
      category: 'food',
      amount: 1500,
      currency: 'USD',
      converted: null,
    });
    expect(result.cityGroups[0].budgetSubtotal).toEqual(
      detail().cityGroups[0].budgetSubtotal,
    );
  });

  describe('linked bookings (ITN-27)', () => {
    /** The detail with one flight linked to the first day, in `currency`. */
    const withLink = (currency: string) => {
      const linked = detail();
      linked.days[0].linkedBookings = [
        {
          id: 'l1',
          bookingType: LinkedBookingType.Flight,
          bookingId: 'k1',
          reference: 'FB-7KQ2MX',
          amount: 52000,
          currency,
        },
      ];
      return linked;
    };

    it('gives every linked booking its converted amount, with the same rule', () => {
      const result = withConvertedAmounts(withLink('EGP'), {
        currency: 'USD',
        rates: RATES,
      });

      // EGP 520.00 = USD 10.40.
      expect(result.days[0].linkedBookings[0]).toEqual({
        id: 'l1',
        bookingType: 'flight',
        bookingId: 'k1',
        reference: 'FB-7KQ2MX',
        amount: 52000,
        currency: 'EGP',
        converted: { amount: 1040, currency: 'USD' },
      });
    });

    it('names the currency of a linked booking that has no rate', () => {
      const result = withConvertedAmounts(withLink('CHF'), {
        currency: 'USD',
        rates: RATES,
      });

      expect(result.days[0].linkedBookings[0].converted).toBeNull();
      expect(result.conversion?.missingCurrencies).toEqual(['CHF', 'GBP']);
    });
  });
});
