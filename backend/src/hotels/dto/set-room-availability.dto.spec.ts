import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { SetRoomAvailabilityDto } from './set-room-availability.dto';

/** Every message of an error and of its nested errors. */
const messagesOf = (error: ValidationError): string[] => [
  ...Object.values(error.constraints ?? {}),
  ...(error.children ?? []).flatMap(messagesOf),
];

const messages = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(SetRoomAvailabilityDto, body))).flatMap(
    messagesOf,
  );

describe('SetRoomAvailabilityDto', () => {
  describe('availability (HTL-05)', () => {
    it('accepts a list of date ranges', async () => {
      expect(
        await messages({
          availability: [
            { from: '2026-12-01', to: '2026-12-08' },
            { from: '2026-12-20', to: '2027-01-05' },
          ],
        }),
      ).toEqual([]);
    });

    it('accepts an empty list, which makes the room unbookable', async () => {
      expect(await messages({ availability: [] })).toEqual([]);
    });

    it('rejects null and a value that is not a list', async () => {
      expect(await messages({ availability: null })).toContain(
        'availability must be a list',
      );
      expect(await messages({ availability: 'always' })).toContain(
        'availability must be a list',
      );
    });

    it('rejects a range whose from is not before its to', async () => {
      expect(
        await messages({
          availability: [{ from: '2026-12-08', to: '2026-12-01' }],
        }),
      ).toEqual(['from must be earlier than to']);
      expect(
        await messages({
          availability: [{ from: '2026-12-01', to: '2026-12-01' }],
        }),
      ).toEqual(['from must be earlier than to']);
    });

    it('rejects a date that is not YYYY-MM-DD or not a real date', async () => {
      expect(
        await messages({
          availability: [{ from: '01/12/2026', to: '2026-12-08' }],
        }),
      ).toContain('from must be a date in the form YYYY-MM-DD');
      expect(
        await messages({
          availability: [{ from: '2026-12-01', to: '2026-02-30' }],
        }),
      ).toContain('to must be a real calendar date');
    });

    it('rejects a range with a missing date', async () => {
      expect(
        await messages({ availability: [{ from: '2026-12-01' }] }),
      ).toContain('to must be a date in the form YYYY-MM-DD');
    });

    it('rejects more than 100 ranges', async () => {
      const many = Array.from({ length: 101 }, (_, index) => {
        const year = 2027 + index;
        return { from: `${year}-01-01`, to: `${year}-01-02` };
      });

      expect(await messages({ availability: many })).toEqual([
        'availability must have at most 100 ranges',
      ]);
    });
  });

  describe('blocked (HTL-06)', () => {
    it('accepts a list of blocked date ranges', async () => {
      expect(
        await messages({ blocked: [{ from: '2026-12-10', to: '2026-12-12' }] }),
      ).toEqual([]);
    });

    it('accepts an empty list, which removes every block', async () => {
      expect(await messages({ blocked: [] })).toEqual([]);
    });

    it('rejects null, a value that is not a list and a reversed range', async () => {
      expect(await messages({ blocked: null })).toContain(
        'blocked must be a list',
      );
      expect(await messages({ blocked: 'repairs' })).toContain(
        'blocked must be a list',
      );
      expect(
        await messages({ blocked: [{ from: '2026-12-12', to: '2026-12-10' }] }),
      ).toEqual(['from must be earlier than to']);
    });
  });

  it('accepts both lists in one request', async () => {
    expect(
      await messages({
        availability: [{ from: '2026-12-01', to: '2026-12-31' }],
        blocked: [{ from: '2026-12-10', to: '2026-12-12' }],
      }),
    ).toEqual([]);
  });

  it('leaves an empty body to the service, which answers 400 for it', async () => {
    expect(await messages({})).toEqual([]);
  });
});
