import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MoveDayDto } from './move-day.dto';

const valid = { dayId: '6741c0ffee0ddba11ad0d0d0', position: 2 };

const invalidFields = async (
  body: Record<string, unknown>,
): Promise<string[]> =>
  (await validate(plainToInstance(MoveDayDto, body)))
    .map((error) => error.property)
    .sort();

describe('MoveDayDto', () => {
  it('accepts a day id and a position', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('requires both fields', async () => {
    expect(await invalidFields({})).toEqual(['dayId', 'position']);
  });

  it.each([
    ['a day id that is not an id', { dayId: 'day-1' }, 'dayId'],
    ['position 0', { position: 0 }, 'position'],
    ['a position above 60', { position: 61 }, 'position'],
    ['a fractional position', { position: 1.5 }, 'position'],
    ['a position that is text', { position: '2' }, 'position'],
  ])('rejects %s', async (_label, change, field) => {
    expect(await invalidFields({ ...valid, ...change })).toEqual([field]);
  });
});
