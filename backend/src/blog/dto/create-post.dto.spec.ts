import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import {
  CreatePostDto,
  POST_BODY_MAX_LENGTH,
  POST_TITLE_MAX_LENGTH,
} from './create-post.dto';
import { PostStatus } from '../models/post-status.enum';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreatePostDto,
};

const valid = {
  title: 'Three days in Cairo',
  body: 'I spent three amazing days exploring Cairo.',
  status: PostStatus.Draft,
  tags: ['cairo', 'egypt'],
};

const parse = (body: Record<string, unknown>): Promise<CreatePostDto> =>
  pipe.transform(body, metadata) as Promise<CreatePostDto>;

async function errorsOf(body: Record<string, unknown>): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }

    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const invalidFields = async (
  body: Record<string, unknown>,
): Promise<string[]> => (await errorsOf(body)).map(({ field }) => field).sort();

describe('CreatePostDto (BLG-01)', () => {
  it('accepts a valid post with optional status and tags', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(CreatePostDto);
    expect(dto).toEqual(valid);
  });

  it('accepts a post without optional status and tags', async () => {
    const dto = await parse({
      title: 'Three days in Cairo',
      body: 'I spent three amazing days exploring Cairo.',
    });

    expect(dto).toBeInstanceOf(CreatePostDto);
    expect(dto.title).toBe('Three days in Cairo');
    expect(dto.body).toBe('I spent three amazing days exploring Cairo.');
  });

  it.each([
    ['title', ''],
    ['title', undefined],
    ['body', ''],
    ['body', undefined],
  ])('rejects an invalid %s', async (field, value) => {
    expect(await invalidFields({ ...valid, [field]: value })).toEqual([field]);
  });

  it('rejects a blank title after trimming', async () => {
    expect(
      await invalidFields({
        ...valid,
        title: '   ',
      }),
    ).toEqual(['title']);
  });

  it('rejects a blank body after trimming', async () => {
    expect(
      await invalidFields({
        ...valid,
        body: '   ',
      }),
    ).toEqual(['body']);
  });

  it('rejects an invalid post status', async () => {
    expect(
      await invalidFields({
        ...valid,
        status: 'invalid-status',
      }),
    ).toEqual(['status']);
  });

  it('trims and lowercases tags and removes duplicates and empty tags', async () => {
    const dto = await parse({
      ...valid,
      tags: [' Cairo ', 'EGYPT', 'cairo', ' ', ' Travel '],
    });

    expect(dto.tags).toEqual(['cairo', 'egypt', 'travel']);
  });

  it('rejects tags that are not an array', async () => {
    expect(
      await invalidFields({
        ...valid,
        tags: 'cairo',
      }),
    ).toEqual(['tags']);
  });

  it('rejects tags containing non-string values', async () => {
    expect(
      await invalidFields({
        ...valid,
        tags: ['cairo', 123],
      }),
    ).toEqual(['tags']);
  });

  it('rejects more than five tags', async () => {
    expect(
      await invalidFields({
        ...valid,
        tags: ['one', 'two', 'three', 'four', 'five', 'six'],
      }),
    ).toEqual(['tags']);
  });

  it('rejects a tag longer than 30 characters', async () => {
    expect(
      await invalidFields({
        ...valid,
        tags: ['a'.repeat(31)],
      }),
    ).toEqual(['tags']);
  });

  it('rejects unknown fields', async () => {
    expect(
      await invalidFields({
        ...valid,
        unknownField: 'not allowed',
      }),
    ).toEqual(['unknownField']);
  });

  it('accepts a title and a body exactly at their limits', async () => {
    expect(
      await invalidFields({
        ...valid,
        title: 'a'.repeat(POST_TITLE_MAX_LENGTH),
        body: 'b'.repeat(POST_BODY_MAX_LENGTH),
      }),
    ).toEqual([]);
  });

  it('rejects a title longer than the limit', async () => {
    expect(
      await invalidFields({
        ...valid,
        title: 'a'.repeat(POST_TITLE_MAX_LENGTH + 1),
      }),
    ).toEqual(['title']);
  });

  it('rejects a body longer than the limit', async () => {
    expect(
      await invalidFields({
        ...valid,
        body: 'b'.repeat(POST_BODY_MAX_LENGTH + 1),
      }),
    ).toEqual(['body']);
  });

  it('counts the limit after trimming, so outer spaces do not count', async () => {
    const dto = await parse({
      ...valid,
      title: `  ${'a'.repeat(POST_TITLE_MAX_LENGTH)}  `,
    });

    expect(dto.title).toHaveLength(POST_TITLE_MAX_LENGTH);
  });

  it.each(['authorId', 'images', 'publishedAt', 'likeCount'])(
    'rejects %s, which the server sets',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );
});
