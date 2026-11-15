import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreatePostDto } from './create-post.dto';
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

  it('rejects an invalid post status', async () => {
    expect(
      await invalidFields({
        ...valid,
        status: 'invalid-status',
      }),
    ).toEqual(['status']);
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

  it('rejects unknown fields', async () => {
    expect(
      await invalidFields({
        ...valid,
        unknownField: 'not allowed',
      }),
    ).toEqual(['unknownField']);
  });
});
