import {
  BORN_AFTER_DEPARTURE_MESSAGE,
  DUPLICATE_PASSPORT_MESSAGE,
  NO_ADULT_MESSAGE,
  NO_EXTRA_BAGS_MESSAGE,
  planPassengers,
  planReturnPassengers,
  returnBagsWithoutReturnFlight,
  TOO_MANY_INFANTS_MESSAGE,
  TOO_MANY_SEATS_MESSAGE,
  tooHeavyMessage,
  tooManyBagsMessage,
  type BaggageRule,
} from './booking-passengers';
import type { PassengerDetailsDto } from './dto/hold-flight-booking.dto';
import { PassengerType } from './enums/passenger-type.enum';
import {
  INFANT_ON_RETURN_MESSAGE,
  RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE,
} from './flight-bookings.constants';

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

describe('planReturnPassengers (FLT-12(a))', () => {
  const RETURN_DATE = '2026-12-27';
  const RETURN_RULE: BaggageRule = {
    extraBagPrice: 4000,
    maxExtraBags: 1,
    maxBagKg: 32,
  };
  const typesOf = (passengers: PassengerDetailsDto[]) => {
    const plan = planPassengers(passengers, DEPARTURE, SELLS).plan;
    if (!plan) throw new Error('expected a valid outbound plan');
    return plan.passengers.map(({ type }) => type);
  };

  it("keeps the outbound types and prices each passenger's bags at the return airline price", () => {
    const passengers = [
      adult({ returnExtraBags: { bags: 1, weightKg: 30 } }),
      child(),
      infant(),
    ];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ),
    ).toEqual({
      passengers: [
        {
          type: PassengerType.Adult,
          extraBags: { bags: 1, weightKg: 30 },
          baggageFee: 4000,
        },
        { type: PassengerType.Child, baggageFee: 0 },
        { type: PassengerType.Infant, baggageFee: 0 },
      ],
      errors: [],
    });
  });

  it('refuses an infant who turns 2 before the return date, on dateOfBirth', () => {
    // 1 on 2026-12-20, 2 on 2026-12-25.
    const passengers = [adult(), person('2024-12-25')];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ),
    ).toEqual({
      passengers: null,
      errors: [
        {
          field: 'passengers.1.dateOfBirth',
          messages: [INFANT_ON_RETURN_MESSAGE],
        },
      ],
    });
  });

  it('accepts an infant whose second birthday is the day after the return', () => {
    const passengers = [adult(), person('2024-12-28')];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ).errors,
    ).toEqual([]);
  });

  it('refuses an infant whose second birthday is the return date itself', () => {
    const passengers = [adult(), person('2024-12-27')];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ).errors,
    ).toEqual([
      {
        field: 'passengers.1.dateOfBirth',
        messages: [INFANT_ON_RETURN_MESSAGE],
      },
    ]);
  });

  it('lets a child become an adult on the return: same seat, same fare', () => {
    // 11 outbound, 12 on the return date.
    const passengers = [adult(), person('2014-12-25')];

    const result = planReturnPassengers(
      passengers,
      typesOf(passengers),
      RETURN_DATE,
      RETURN_RULE,
    );
    expect(result.errors).toEqual([]);
    expect(result.passengers?.[1].type).toBe(PassengerType.Child);
  });

  it('checks the return bags with the return rule, on the returnExtraBags path', () => {
    const passengers = [
      adult({ returnExtraBags: { bags: 2, weightKg: 10 } }),
      adult({ returnExtraBags: { bags: 1, weightKg: 33 } }),
    ];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ).errors,
    ).toEqual([
      {
        field: 'passengers.0.returnExtraBags.bags',
        messages: [tooManyBagsMessage(1)],
      },
      {
        field: 'passengers.1.returnExtraBags.weightKg',
        messages: [tooHeavyMessage(1, 32)],
      },
    ]);
  });

  it('refuses return bags when the return airline sells none (no price, or a maximum of 0)', () => {
    const passengers = [adult({ returnExtraBags: { bags: 1, weightKg: 5 } })];
    for (const rule of [
      { maxExtraBags: 1, maxBagKg: 32 },
      { extraBagPrice: 4000, maxExtraBags: 0, maxBagKg: 32 },
    ]) {
      expect(
        planReturnPassengers(passengers, typesOf(passengers), RETURN_DATE, rule)
          .errors,
      ).toEqual([
        {
          field: 'passengers.0.returnExtraBags',
          messages: [NO_EXTRA_BAGS_MESSAGE],
        },
      ]);
    }
  });

  it('ignores the outbound extraBags: they belong to the outbound flight', () => {
    const passengers = [adult({ extraBags: { bags: 2, weightKg: 40 } })];

    expect(
      planReturnPassengers(
        passengers,
        typesOf(passengers),
        RETURN_DATE,
        RETURN_RULE,
      ),
    ).toEqual({
      passengers: [{ type: PassengerType.Adult, baggageFee: 0 }],
      errors: [],
    });
  });
});

describe('returnBagsWithoutReturnFlight (FLT-12(a))', () => {
  it('names each passenger who sent returnExtraBags on a one-way booking', () => {
    expect(
      returnBagsWithoutReturnFlight([
        adult({ returnExtraBags: { bags: 1, weightKg: 5 } }),
        adult(),
        adult({ returnExtraBags: null }),
        adult({ returnExtraBags: { bags: 1, weightKg: 5 } }),
      ]),
    ).toEqual([
      {
        field: 'passengers.0.returnExtraBags',
        messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
      },
      {
        field: 'passengers.3.returnExtraBags',
        messages: [RETURN_BAGS_WITHOUT_FLIGHT_MESSAGE],
      },
    ]);
  });

  it('finds nothing when no passenger sent them', () => {
    expect(returnBagsWithoutReturnFlight([adult(), child()])).toEqual([]);
  });
});
