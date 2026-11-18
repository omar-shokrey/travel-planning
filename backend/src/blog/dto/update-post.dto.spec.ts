import {
  BadRequestException,
  ValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { POST_BODY_MAX_LENGTH, POST_TITLE_MAX_LENGTH } from './create-post.dto';
import { UpdatePostDto } from './update-post.dto';
import { PostStatus } from '../models/post-status.enum';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: UpdatePostDto,
};

const parse = (body: Record<string, unknown>): Promise<UpdatePostDto> =>
  pipe.transform(body, metadata) as Promise<UpdatePostDto>;

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

describe('UpdatePostDto (BLG-04)', () => {
  it('accepts an empty update', async () => {
    const dto = await parse({});

    expect(dto).toBeInstanceOf(UpdatePostDto);
  });

  it('accepts a valid update with all editable fields', async () => {
    const dto = await parse({
      title: 'Updated Cairo trip',
      body: 'Updated travel experience.',
      status: PostStatus.Published,
    });

    expect(dto).toBeInstanceOf(UpdatePostDto);
    expect(dto.title).toBe('Updated Cairo trip');
    expect(dto.body).toBe('Updated travel experience.');
    expect(dto.status).toBe(PostStatus.Published);
  });

  it('trims title and body', async () => {
    const dto = await parse({
      title: '  Updated title  ',
      body: '  Updated body  ',
    });

    expect(dto.title).toBe('Updated title');
    expect(dto.body).toBe('Updated body');
  });

  it.each([
    ['title', ''],
    ['title', '   '],
    ['body', ''],
    ['body', '   '],
  ])('rejects a blank %s', async (field, value) => {
    expect(await invalidFields({ [field]: value })).toEqual([field]);
  });

  it('rejects an invalid status', async () => {
    expect(
      await invalidFields({
        status: 'invalid-status',
      }),
    ).toEqual(['status']);
  });

  it('accepts title and body exactly at their limits', async () => {
    expect(
      await invalidFields({
        title: 'a'.repeat(POST_TITLE_MAX_LENGTH),
        body: 'b'.repeat(POST_BODY_MAX_LENGTH),
      }),
    ).toEqual([]);
  });

  it('rejects a title longer than the limit', async () => {
    expect(
      await invalidFields({
        title: 'a'.repeat(POST_TITLE_MAX_LENGTH + 1),
      }),
    ).toEqual(['title']);
  });

  it('rejects a body longer than the limit', async () => {
    expect(
      await invalidFields({
        body: 'b'.repeat(POST_BODY_MAX_LENGTH + 1),
      }),
    ).toEqual(['body']);
  });

  it.each([
    'authorId',
    'images',
    'publishedAt',
    'likeCount',
    'commentCount',
    'createdAt',
    'updatedAt',
  ])('rejects server-controlled field %s', async (field) => {
    expect(await invalidFields({ [field]: 'x' })).toEqual([field]);
  });

  it('rejects null for editable fields', async () => {
    expect(
      await invalidFields({
        title: null,
        body: null,
        status: null,
      }),
    ).toEqual(['body', 'status', 'title']);
  });
});
