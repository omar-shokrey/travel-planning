import { ValidationPipe } from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateReviewReplyDto } from './create-review-reply.dto';

// The same options as the global pipe in app.setup.ts, its error shape too.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const run = async (body: unknown) => {
  try {
    return {
      value: (await pipe.transform(body, {
        type: 'body',
        metatype: CreateReviewReplyDto,
      })) as CreateReviewReplyDto,
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

describe('CreateReviewReplyDto (HTL-26)', () => {
  it.each([
    ['1 character', 'a'],
    ['1000 characters', 'a'.repeat(1000)],
  ])('accepts a reply of %s', async (_label, text) => {
    const { value, messages } = await run({ text });

    expect(messages).toEqual([]);
    expect(value?.text).toBe(text);
  });

  it('removes the outer spaces', async () => {
    expect((await run({ text: '  Thank you!  ' })).value?.text).toBe(
      'Thank you!',
    );
  });

  it('counts the 1000 characters after the outer spaces are removed', async () => {
    expect((await run({ text: `  ${'a'.repeat(1000)}  ` })).messages).toEqual(
      [],
    );
  });

  it.each([
    ['no text', {}, 'text is required'],
    ['a null text', { text: null }, 'text is required'],
    ['an empty text', { text: '' }, 'text must not be empty'],
    ['a text of spaces only', { text: '   ' }, 'text must not be empty'],
    [
      '1001 characters',
      { text: 'a'.repeat(1001) },
      'text must have at most 1000 characters',
    ],
    ['a number', { text: 7 }, 'text must be a text'],
    ['an array', { text: ['Thanks'] }, 'text must be a text'],
  ])('refuses %s', async (_label, body, message) => {
    expect((await run(body)).messages).toContain(message);
  });

  it('refuses the fields the server sets and any other field', async () => {
    const { messages } = await run({
      text: 'Thanks',
      rating: 5,
      moderatorId: '6740f1c2a4b5c6d7e8f90123',
      repliedAt: '2027-06-22T09:15:00.000Z',
    });

    expect(messages).toEqual(
      expect.arrayContaining([
        'property rating should not exist',
        'property moderatorId should not exist',
        'property repliedAt should not exist',
      ]),
    );
  });
});
