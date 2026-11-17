import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateReviewDto } from './create-review.dto';
import { UpdateReviewDto } from './update-review.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const parse = <T>(metatype: new () => T, body: object) =>
  pipe.transform(body, {
    type: 'body',
    metatype,
  } as ArgumentMetadata) as Promise<T>;

const failedFields = async (
  metatype: new () => object,
  body: object,
): Promise<string[]> => {
  try {
    await parse(metatype, body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      errors: { field: string }[];
    };
    return response.errors.map((entry) => entry.field);
  }
  throw new Error('The body was accepted');
};

describe('CreateReviewDto (HTL-23)', () => {
  it('accepts a rating with a text, trimmed', async () => {
    const dto = await parse(CreateReviewDto, {
      rating: 5,
      text: '  Great breakfast.  ',
    });

    expect(dto).toEqual({ rating: 5, text: 'Great breakfast.' });
  });

  it('accepts a rating alone, and 1000 characters of text', async () => {
    expect(await parse(CreateReviewDto, { rating: 1 })).toEqual({ rating: 1 });
    await expect(
      parse(CreateReviewDto, { rating: 3, text: 'x'.repeat(1000) }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['no rating', {}, 'rating'],
    ['a rating of 0', { rating: 0 }, 'rating'],
    ['a rating of 6', { rating: 6 }, 'rating'],
    ['a rating of 4.5', { rating: 4.5 }, 'rating'],
    ['a rating as text', { rating: '5' }, 'rating'],
    ['1001 characters', { rating: 3, text: 'x'.repeat(1001) }, 'text'],
    ['a text that is not text', { rating: 3, text: 7 }, 'text'],
    ['a hotel id from the client', { rating: 3, hotelId: 'h' }, 'hotelId'],
    ['an author from the client', { rating: 3, userId: 'u' }, 'userId'],
  ])('refuses %s', async (_, body, field) => {
    expect(await failedFields(CreateReviewDto, body)).toContain(field);
  });
});

describe('UpdateReviewDto (HTL-23)', () => {
  it('accepts only a rating, only a text, or an empty text', async () => {
    expect(await parse(UpdateReviewDto, { rating: 2 })).toEqual({ rating: 2 });
    expect(await parse(UpdateReviewDto, { text: ' Fine ' })).toEqual({
      text: 'Fine',
    });
    expect(await parse(UpdateReviewDto, { text: '' })).toEqual({ text: '' });
  });

  it('keeps the rules of a new review', async () => {
    expect(await failedFields(UpdateReviewDto, { rating: 9 })).toEqual([
      'rating',
    ]);
    expect(
      await failedFields(UpdateReviewDto, { text: 'x'.repeat(1001) }),
    ).toEqual(['text']);
  });
});
