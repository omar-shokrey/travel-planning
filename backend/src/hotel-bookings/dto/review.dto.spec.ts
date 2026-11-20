import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CreateReviewDto } from './create-review.dto';
import { UpdateReviewDto } from './update-review.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const run = async (metatype: ArgumentMetadata['metatype'], body: unknown) => {
  try {
    return {
      value: (await pipe.transform(body, { type: 'body', metatype })) as {
        rating?: number;
        text?: string;
      },
      messages: [] as string[],
    };
  } catch (error) {
    return {
      value: undefined,
      messages: (error as { response: { message: string[] } }).response.message,
    };
  }
};

describe('CreateReviewDto (HTL-23)', () => {
  it.each([1, 3, 5])('accepts the rating %p without text', async (rating) => {
    expect((await run(CreateReviewDto, { rating })).messages).toEqual([]);
  });

  it('trims the text and accepts 1000 characters', async () => {
    expect(
      (await run(CreateReviewDto, { rating: 4, text: '  Nice  ' })).value?.text,
    ).toBe('Nice');
    expect(
      (await run(CreateReviewDto, { rating: 4, text: 'a'.repeat(1000) }))
        .messages,
    ).toEqual([]);
  });

  it.each([
    [{}, 'rating is required'],
    [{ rating: 0 }, 'rating must be at least 1'],
    [{ rating: 6 }, 'rating must be at most 5'],
    [{ rating: 4.5 }, 'rating must be a whole number'],
    [{ rating: '4' }, 'rating must be a whole number'],
    [
      { rating: 4, text: 'a'.repeat(1001) },
      'text must have at most 1000 characters',
    ],
    [{ rating: 4, text: 7 }, 'text must be a text'],
    [{ rating: 4, text: null }, 'text must be a text'],
  ])('refuses %p', async (body, message) => {
    expect((await run(CreateReviewDto, body)).messages).toContain(message);
  });

  it('refuses a field the client may not send, such as the hotel or the author', async () => {
    const { messages } = await run(CreateReviewDto, {
      rating: 4,
      hotelId: 'x',
      userId: 'y',
      moderation: 'visible',
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'property hotelId should not exist',
        'property userId should not exist',
        'property moderation should not exist',
      ]),
    );
  });
});

describe('UpdateReviewDto (HTL-23)', () => {
  it.each([[{ rating: 2 }], [{ text: 'Better now' }], [{ text: '' }], [{}]])(
    'accepts %p (the service refuses an empty body)',
    async (body) => {
      expect((await run(UpdateReviewDto, body)).messages).toEqual([]);
    },
  );

  it.each([
    [{ rating: null }, 'rating must be a whole number'],
    [{ rating: 0 }, 'rating must be at least 1'],
    [{ text: null }, 'text must be a text'],
    [{ text: 'a'.repeat(1001) }, 'text must have at most 1000 characters'],
  ])('refuses %p', async (body, message) => {
    expect((await run(UpdateReviewDto, body)).messages).toContain(message);
  });
});
