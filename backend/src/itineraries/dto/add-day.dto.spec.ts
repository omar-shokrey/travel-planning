import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddDayDto } from './add-day.dto';
import { UpdateDayDto } from './update-day.dto';

const invalidFields = async (
  body: Record<string, unknown>,
  dto: typeof AddDayDto | typeof UpdateDayDto = AddDayDto,
): Promise<string[]> =>
  (await validate(plainToInstance(dto, body)))
    .map((error) => error.property)
    .sort();

describe('AddDayDto', () => {
  it('accepts a city, with or without notes', async () => {
    expect(await invalidFields({ cityId: 'cairo' })).toEqual([]);
    expect(
      await invalidFields({ cityId: 'cairo', notes: 'Arrive late' }),
    ).toEqual([]);
  });

  it('requires a city (ITN-09)', async () => {
    expect(await invalidFields({})).toEqual(['cityId']);
    expect(await invalidFields({ notes: 'No city' })).toEqual(['cityId']);
  });

  it.each([
    ['an empty city', ''],
    ['a city of only spaces', '   '],
    ['a city that is not text', 7],
  ])('rejects %s', async (_label, cityId) => {
    expect(await invalidFields({ cityId })).toEqual(['cityId']);
  });

  it('rejects notes that are not text', async () => {
    expect(await invalidFields({ cityId: 'cairo', notes: 5 })).toEqual([
      'notes',
    ]);
  });

  it('trims the city and the notes', () => {
    const dto = plainToInstance(AddDayDto, {
      cityId: ' cairo ',
      notes: '  Arrive late  ',
    });

    expect(dto.cityId).toBe('cairo');
    expect(dto.notes).toBe('Arrive late');
  });
});

describe('UpdateDayDto', () => {
  it('accepts a body with only the field that changes', async () => {
    expect(await invalidFields({ notes: 'New notes' }, UpdateDayDto)).toEqual(
      [],
    );
    expect(await invalidFields({ cityId: 'dubai' }, UpdateDayDto)).toEqual([]);
    expect(await invalidFields({}, UpdateDayDto)).toEqual([]);
  });

  it('still checks the fields that are sent', async () => {
    expect(await invalidFields({ cityId: '', notes: 5 }, UpdateDayDto)).toEqual(
      ['cityId', 'notes'],
    );
  });
});
