import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItineraryDto } from './create-itinerary.dto';
import { UpdateItineraryDto } from './update-itinerary.dto';

const valid = {
  title: 'Ten days in Egypt',
  countries: ['EG', 'AE'],
  startDate: '2026-12-20',
};

const invalidFields = async (
  body: Record<string, unknown>,
  dto:
    typeof CreateItineraryDto | typeof UpdateItineraryDto = CreateItineraryDto,
): Promise<string[]> =>
  (await validate(plainToInstance(dto, body)))
    .map((error) => error.property)
    .sort();

describe('CreateItineraryDto', () => {
  it('accepts a title, countries and a start date', async () => {
    expect(await invalidFields(valid)).toEqual([]);
  });

  it('requires all three fields', async () => {
    expect(await invalidFields({})).toEqual([
      'countries',
      'startDate',
      'title',
    ]);
  });

  it('trims the title', () => {
    const dto = plainToInstance(CreateItineraryDto, {
      ...valid,
      title: '  Egypt  ',
    });

    expect(dto.title).toBe('Egypt');
  });

  it.each([
    ['an empty title', ''],
    ['a title of only spaces', '   '],
    ['a title above 100 characters', 'x'.repeat(101)],
    ['a title that is not text', 42],
  ])('rejects %s', async (_label, title) => {
    expect(await invalidFields({ ...valid, title })).toEqual(['title']);
  });

  it('accepts a title of exactly 100 characters', async () => {
    expect(await invalidFields({ ...valid, title: 'x'.repeat(100) })).toEqual(
      [],
    );
  });

  it.each([
    ['no country', []],
    ['a repeated country', ['EG', 'EG']],
    ['a country name instead of a code', ['Egypt']],
    ['a lowercase code', ['eg']],
    ['a single code instead of a list', 'EG'],
  ])('rejects %s', async (_label, countries) => {
    expect(await invalidFields({ ...valid, countries })).toEqual(['countries']);
  });

  it.each([
    ['a date with a time', '2026-12-20T10:00:00Z'],
    ['a day-first date', '20-12-2026'],
    ['a date that does not exist', '2026-02-30'],
    ['a month that does not exist', '2026-13-01'],
    ['a number', 20261220],
  ])('rejects %s as the start date', async (_label, startDate) => {
    expect(await invalidFields({ ...valid, startDate })).toEqual(['startDate']);
  });
});

describe('UpdateItineraryDto', () => {
  it('accepts a body with only the field that changes', async () => {
    expect(
      await invalidFields({ title: 'New title' }, UpdateItineraryDto),
    ).toEqual([]);
    expect(await invalidFields({}, UpdateItineraryDto)).toEqual([]);
  });

  it('still checks the fields that are sent', async () => {
    expect(
      await invalidFields(
        { title: '', countries: [], startDate: 'tomorrow' },
        UpdateItineraryDto,
      ),
    ).toEqual(['countries', 'startDate', 'title']);
  });
});
