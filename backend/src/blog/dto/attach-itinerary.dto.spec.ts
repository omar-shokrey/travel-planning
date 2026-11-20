import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AttachItineraryDto } from './attach-itinerary.dto';

/** The fields that fail, with the options of the global ValidationPipe. */
const invalidFields = async (body: Record<string, unknown>) =>
  (
    await validate(plainToInstance(AttachItineraryDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  )
    .map((error) => error.property)
    .sort();

describe('AttachItineraryDto (BLG-13)', () => {
  it('accepts an itinerary id', async () => {
    expect(
      await invalidFields({ itineraryId: '6741c0ffee0ddba11ad0b0b0' }),
    ).toEqual([]);
  });

  it('accepts null, which removes the itinerary', async () => {
    expect(await invalidFields({ itineraryId: null })).toEqual([]);
  });

  it('refuses a body without the key: a missing key is never a silent detach', async () => {
    expect(await invalidFields({})).toEqual(['itineraryId']);
  });

  it.each([
    ['a string that is not an id', 'abc'],
    ['a number', 12],
    ['an empty string', ''],
    ['an object', { id: '6741c0ffee0ddba11ad0b0b0' }],
    ['a list', ['6741c0ffee0ddba11ad0b0b0']],
  ])('refuses %s', async (_name, itineraryId) => {
    expect(await invalidFields({ itineraryId })).toEqual(['itineraryId']);
  });

  it('refuses any other field, such as the author or the status', async () => {
    expect(
      await invalidFields({
        itineraryId: null,
        authorId: '507f1f77bcf86cd799439011',
        status: 'published',
      }),
    ).toEqual(['authorId', 'status']);
  });

  it('names the field and what it must be', async () => {
    const [error] = await validate(
      plainToInstance(AttachItineraryDto, { itineraryId: 'abc' }),
    );

    expect(Object.values(error.constraints ?? {})).toEqual([
      'itineraryId must be an itinerary id or null',
    ]);
  });
});
