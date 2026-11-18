import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { SetHotelPoliciesDto } from './set-hotel-policies.dto';

const VALID = {
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
};

/** Every message of an error and of its nested errors. */
const messagesOf = (error: ValidationError): string[] => [
  ...Object.values(error.constraints ?? {}),
  ...(error.children ?? []).flatMap(messagesOf),
];

const validateBody = (body: Record<string, unknown>) =>
  validate(plainToInstance(SetHotelPoliciesDto, body));

/** The names of the invalid top-level fields. */
const check = async (body: Record<string, unknown>) =>
  (await validateBody(body)).map((error) => error.property);

/** Every validation message for the tiers. */
const tierMessages = async (cancellationTiers: unknown) =>
  (await validateBody({ ...VALID, cancellationTiers })).flatMap(messagesOf);

describe('SetHotelPoliciesDto', () => {
  describe('check-in and check-out times (HTL-09)', () => {
    it('accepts two times on the 24-hour clock', async () => {
      expect(await check(VALID)).toEqual([]);
    });

    it('accepts midnight and the last minute of the day', async () => {
      expect(
        await check({ ...VALID, checkInTime: '00:00', checkOutTime: '23:59' }),
      ).toEqual([]);
    });

    it.each(['24:00', '14:60', '2:00', '14:0', '2pm', '14.00', '14:00:00', ''])(
      'rejects the check-in time "%s"',
      async (checkInTime) => {
        expect(await check({ ...VALID, checkInTime })).toEqual(['checkInTime']);
      },
    );

    it('rejects a check-out time that is not HH:mm', async () => {
      expect(await check({ ...VALID, checkOutTime: 'noon' })).toEqual([
        'checkOutTime',
      ]);
    });

    it('rejects a missing time, because PUT replaces the whole policy', async () => {
      const { checkInTime: _in, ...withoutCheckIn } = VALID;
      const { checkOutTime: _out, ...withoutCheckOut } = VALID;

      expect(await check(withoutCheckIn)).toEqual(['checkInTime']);
      expect(await check(withoutCheckOut)).toEqual(['checkOutTime']);
    });

    it('rejects a time that is not text', async () => {
      expect(await check({ ...VALID, checkInTime: 1400 })).toEqual([
        'checkInTime',
      ]);
    });
  });

  describe('cancellation tiers (HTL-10)', () => {
    it('accepts an empty list, which means no refund', async () => {
      expect(await tierMessages([])).toEqual([]);
    });

    it('accepts the limits: threshold 0, refund 0 and refund 100', async () => {
      expect(
        await tierMessages([
          { daysBefore: 0, refundPercent: 0 },
          { daysBefore: 1, refundPercent: 100 },
        ]),
      ).toEqual([]);
    });

    it('rejects two tiers with the same threshold', async () => {
      expect(
        await tierMessages([
          { daysBefore: 7, refundPercent: 50 },
          { daysBefore: 7, refundPercent: 80 },
        ]),
      ).toEqual(['Each cancellation tier must have a different daysBefore']);
    });

    it('rejects a negative threshold and a threshold that is not a whole number', async () => {
      expect(
        await tierMessages([{ daysBefore: -1, refundPercent: 50 }]),
      ).toEqual(['daysBefore must be 0 or more']);
      expect(
        await tierMessages([{ daysBefore: 1.5, refundPercent: 50 }]),
      ).toEqual(['daysBefore must be a whole number']);
    });

    it('rejects a refund below 0, above 100 or not a whole number', async () => {
      expect(
        await tierMessages([{ daysBefore: 7, refundPercent: -1 }]),
      ).toEqual(['refundPercent must be between 0 and 100']);
      expect(
        await tierMessages([{ daysBefore: 7, refundPercent: 101 }]),
      ).toEqual(['refundPercent must be between 0 and 100']);
      expect(
        await tierMessages([{ daysBefore: 7, refundPercent: 12.5 }]),
      ).toEqual(['refundPercent must be a whole number']);
    });

    it('rejects a tier with a missing number', async () => {
      expect(await tierMessages([{ daysBefore: 7 }])).toContain(
        'refundPercent must be a whole number',
      );
      expect(await tierMessages([{ refundPercent: 50 }])).toContain(
        'daysBefore must be a whole number',
      );
    });

    it.each([
      ['a list', [[{ daysBefore: 7, refundPercent: 50 }]]],
      ['an empty list', [[]]],
      ['null', [null]],
      ['a number', [7]],
      ['text', ['7 days']],
    ])('rejects a tier that is %s instead of an object', async (_, tiers) => {
      expect(await tierMessages(tiers)).toContain(
        'Each cancellation tier must be an object',
      );
    });

    it('rejects a missing tier list and a value that is not a list', async () => {
      const { cancellationTiers: _tiers, ...withoutTiers } = VALID;

      expect(await check(withoutTiers)).toEqual(['cancellationTiers']);
      expect(await check({ ...VALID, cancellationTiers: 'none' })).toEqual([
        'cancellationTiers',
      ]);
    });

    it('rejects more than 10 tiers', async () => {
      const eleven = Array.from({ length: 11 }, (_, index) => ({
        daysBefore: index,
        refundPercent: 10,
      }));

      expect(await tierMessages(eleven)).toEqual([
        'cancellationTiers must have at most 10 tiers',
      ]);
    });
  });
});
