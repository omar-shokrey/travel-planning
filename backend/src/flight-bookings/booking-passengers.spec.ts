import {
  BORN_AFTER_DEPARTURE_MESSAGE,
  DUPLICATE_PASSPORT_MESSAGE,
  NO_ADULT_MESSAGE,
  NO_EXTRA_BAGS_MESSAGE,
  planPassengers,
  TOO_MANY_INFANTS_MESSAGE,
  TOO_MANY_SEATS_MESSAGE,
  tooHeavyMessage,
  tooManyBagsMessage,
  type BaggageRule,
} from './booking-passengers';
import type { PassengerDetailsDto } from './dto/hold-flight-booking.dto';
import { PassengerType } from './enums/passenger-type.enum';

const DEPARTURE = '2026-12-20';
const SELLS: BaggageRule = {
  extraBagPrice: 4500,
  maxExtraBags: 2,
  maxBagKg: 23,
};

let serial = 0;
const person = (dateOfBirth: string, extra: object = {}) =>
  ({
    fullName: 'Test Passenger',
    dateOfBirth,
    passportNumber: `P${String((serial += 1)).padStart(6, '0')}`,
    ...extra,
  }) as PassengerDetailsDto;
const adult = (extra: object = {}) => person('1990-05-14', extra);
const child = () => person('2018-01-01');
const infant = () => person('2026-01-01');

describe('planPassengers (FLT-19, FLT-12(b))', () => {
  it('derives the types, the counts and the seats on the departure date', () => {
    const result = planPassengers(
      [adult(), child(), infant(), adult()],
      DEPARTURE,
      SELLS,
    );

    expect(result.errors).toEqual([]);
    expect(result.plan?.passengers.map(({ type }) => type)).toEqual([
      PassengerType.Adult,
      PassengerType.Child,
      PassengerType.Infant,
      PassengerType.Adult,
    ]);
    expect(result.plan?.counts).toEqual({ adults: 2, children: 1, infants: 1 });
    expect(result.plan?.seats).toBe(3);
    expect(result.plan?.baggageTotal).toBe(0);
  });

  it('prices the extra bags: bags × the price, per passenger, summed', () => {
    const result = planPassengers(
      [
        adult({ extraBags: { bags: 2, weightKg: 46 } }),
        adult(),
        infant(),
        child(),
      ],
      DEPARTURE,
      SELLS,
    );

    expect(result.plan?.passengers.map(({ baggageFee }) => baggageFee)).toEqual(
      [9000, 0, 0, 0],
    );
    expect(result.plan?.baggageTotal).toBe(9000);
    expect(result.plan?.passengers[0].extraBags).toEqual({
      bags: 2,
      weightKg: 46,
    });
  });

  it('lets an infant buy extra bags too (no exception for infants)', () => {
    const result = planPassengers(
      [adult(), person('2026-01-01', { extraBags: { bags: 1, weightKg: 10 } })],
      DEPARTURE,
      SELLS,
    );

    expect(result.plan?.baggageTotal).toBe(4500);
  });

  describe('passenger rules', () => {
    it('needs an adult', () => {
      expect(
        planPassengers([child(), infant()], DEPARTURE, SELLS).errors,
      ).toEqual([
        { field: 'passengers', messages: [NO_ADULT_MESSAGE] },
        { field: 'passengers', messages: [TOO_MANY_INFANTS_MESSAGE] },
      ]);
    });

    it('allows as many infants as adults, not more', () => {
      expect(
        planPassengers([adult(), infant()], DEPARTURE, SELLS).errors,
      ).toEqual([]);
      expect(
        planPassengers([adult(), infant(), infant()], DEPARTURE, SELLS).errors,
      ).toEqual([
        { field: 'passengers', messages: [TOO_MANY_INFANTS_MESSAGE] },
      ]);
    });

    it('allows 9 adults and children, not 10; infants take no seat', () => {
      const nine = [
        ...Array.from({ length: 5 }, () => adult()),
        ...Array.from({ length: 4 }, child),
      ];
      expect(planPassengers(nine, DEPARTURE, SELLS).plan?.seats).toBe(9);
      expect(
        planPassengers([...nine, infant()], DEPARTURE, SELLS).plan?.seats,
      ).toBe(9);
      expect(
        planPassengers([...nine, child()], DEPARTURE, SELLS).errors,
      ).toEqual([{ field: 'passengers', messages: [TOO_MANY_SEATS_MESSAGE] }]);
    });

    it('refuses the same passport number twice, on the second passenger', () => {
      const first = adult();
      const again = { ...adult(), passportNumber: first.passportNumber };

      expect(
        planPassengers([first, adult(), again], DEPARTURE, SELLS).errors,
      ).toEqual([
        {
          field: 'passengers.2.passportNumber',
          messages: [DUPLICATE_PASSPORT_MESSAGE],
        },
      ]);
    });
  });

  it('refuses a passenger born after the departure date, without the value', () => {
    // Possible when today (UTC) is already the day after a local departure.
    const result = planPassengers(
      [adult(), person('2026-12-21')],
      DEPARTURE,
      SELLS,
    );

    expect(result.errors).toEqual([
      {
        field: 'passengers.1.dateOfBirth',
        messages: [BORN_AFTER_DEPARTURE_MESSAGE],
      },
    ]);
    expect(JSON.stringify(result.errors)).not.toContain('2026-12-21');
    expect(
      planPassengers([adult(), person(DEPARTURE)], DEPARTURE, SELLS).errors,
    ).toEqual([]);
  });

  describe('extra bags (FLT-08)', () => {
    it.each([
      ['no price', { maxExtraBags: 2, maxBagKg: 23 }],
      [
        'a maximum of 0',
        { extraBagPrice: 4500, maxExtraBags: 0, maxBagKg: 23 },
      ],
    ])(
      'refuses bags from an airline with %s, on that passenger',
      (_label, rule) => {
        expect(
          planPassengers(
            [adult(), adult({ extraBags: { bags: 1, weightKg: 5 } })],
            DEPARTURE,
            rule as BaggageRule,
          ).errors,
        ).toEqual([
          {
            field: 'passengers.1.extraBags',
            messages: [NO_EXTRA_BAGS_MESSAGE],
          },
        ]);
      },
    );

    it('allows no bag at all from an airline that sells none', () => {
      expect(
        planPassengers([adult()], DEPARTURE, { maxExtraBags: 0 }).errors,
      ).toEqual([]);
    });

    it("allows the airline's maximum, not one more", () => {
      expect(
        planPassengers(
          [adult({ extraBags: { bags: 2, weightKg: 10 } })],
          DEPARTURE,
          SELLS,
        ).errors,
      ).toEqual([]);
      expect(
        planPassengers(
          [adult({ extraBags: { bags: 3, weightKg: 10 } })],
          DEPARTURE,
          SELLS,
        ).errors,
      ).toEqual([
        {
          field: 'passengers.0.extraBags.bags',
          messages: [tooManyBagsMessage(2)],
        },
      ]);
    });

    it("allows a total weight of bags × the cabin's maxBagKg, not 1 kg more", () => {
      expect(
        planPassengers(
          [adult({ extraBags: { bags: 2, weightKg: 46 } })],
          DEPARTURE,
          SELLS,
        ).errors,
      ).toEqual([]);
      expect(
        planPassengers(
          [adult({ extraBags: { bags: 2, weightKg: 47 } })],
          DEPARTURE,
          SELLS,
        ).errors,
      ).toEqual([
        {
          field: 'passengers.0.extraBags.weightKg',
          messages: [tooHeavyMessage(2, 23)],
        },
      ]);
      expect(tooHeavyMessage(2, 23)).toBe(
        'weightKg must be at most 46 (2 bag(s) of at most 23 kg each)',
      );
    });
  });

  it('reports every problem at once and repeats no personal value', () => {
    const shared = adult({ extraBags: { bags: 5, weightKg: 10 } });
    const result = planPassengers(
      [shared, { ...child(), passportNumber: shared.passportNumber }],
      DEPARTURE,
      SELLS,
    );

    expect(result.plan).toBeNull();
    expect(result.errors.map(({ field }) => field)).toEqual([
      'passengers.0.extraBags.bags',
      'passengers.1.passportNumber',
    ]);
    const text = JSON.stringify(result.errors);
    expect(text).not.toContain(shared.passportNumber);
    expect(text).not.toContain(shared.dateOfBirth);
    expect(text).not.toContain(shared.fullName);
  });
});
