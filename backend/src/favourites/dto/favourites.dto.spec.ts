import { ValidationPipe } from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { AddFavouriteDto } from './add-favourite.dto';
import { ListFavouritesQueryDto } from './list-favourites-query.dto';

// The same options as the global pipe in app.setup.ts, its error shape too.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const run = async (
  metatype: typeof AddFavouriteDto | typeof ListFavouritesQueryDto,
  value: unknown,
  type: 'body' | 'query',
) => {
  try {
    return {
      value: (await pipe.transform(value, { type, metatype })) as object,
      messages: [] as string[],
    };
  } catch (error) {
    const { errors } = (error as { response: { errors: FieldError[] } })
      .response;
    return {
      value: undefined,
      messages: errors.flatMap((fieldError) => fieldError.messages),
    };
  }
};

const ID = '6740f1c2a4b5c6d7e8f90123';

describe('AddFavouriteDto (BON-02)', () => {
  it.each(['hotel', 'itinerary'])(
    'accepts a %s with a valid id',
    async (targetType) => {
      expect(
        (await run(AddFavouriteDto, { targetType, targetId: ID }, 'body'))
          .messages,
      ).toEqual([]);
    },
  );

  it.each([
    [
      'another type',
      { targetType: 'flight', targetId: ID },
      'targetType must be one of: hotel, itinerary',
    ],
    [
      'no type',
      { targetId: ID },
      'targetType must be one of: hotel, itinerary',
    ],
    [
      'an id that is not an id',
      { targetType: 'hotel', targetId: 'abc' },
      'targetId must be a valid id',
    ],
    ['no id', { targetType: 'hotel' }, 'targetId must be a valid id'],
    [
      'the owner',
      { targetType: 'hotel', targetId: ID, userId: ID },
      'property userId should not exist',
    ],
  ])('refuses %s', async (_label, body, message) => {
    expect((await run(AddFavouriteDto, body, 'body')).messages).toContain(
      message,
    );
  });
});

describe('ListFavouritesQueryDto (BON-02)', () => {
  it('pages 10 by default and filters by type when asked', async () => {
    const { value } = await run(
      ListFavouritesQueryDto,
      { targetType: 'itinerary' },
      'query',
    );

    expect(value).toMatchObject({
      page: 1,
      limit: 10,
      targetType: 'itinerary',
    });
  });

  it.each([
    [
      'another type',
      { targetType: 'flight' },
      'targetType must be one of: hotel, itinerary',
    ],
    ['another parameter', { userId: ID }, 'property userId should not exist'],
  ])('refuses %s', async (_label, query, message) => {
    expect(
      (await run(ListFavouritesQueryDto, query, 'query')).messages,
    ).toContain(message);
  });
});
