import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ContentModeration } from '../enums/content-moderation.enum';
import { ModerateContentDto } from './moderate-content.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

function parse<T>(
  metatype: new () => T,
  type: ArgumentMetadata['type'],
  value: Record<string, unknown>,
): Promise<T> {
  return pipe.transform(value, { type, metatype }) as Promise<T>;
}

/** The fields the pipe rejects. Empty when the input is valid. */
async function invalidFields<T>(
  metatype: new () => T,
  type: ArgumentMetadata['type'],
  value: Record<string, unknown>,
): Promise<string[]> {
  try {
    await parse(metatype, type, value);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors
      .map(({ field }) => field)
      .sort();
  }
}

describe('ModerateContentDto (GEN-10)', () => {
  it.each(Object.values(ContentModeration))('accepts %s', async (value) => {
    expect(
      await parse(ModerateContentDto, 'body', { moderation: value }),
    ).toEqual({ moderation: value });
  });

  it.each([undefined, null, '', 'deleted', true])(
    'refuses moderation = %p',
    async (moderation) => {
      expect(
        await invalidFields(ModerateContentDto, 'body', { moderation }),
      ).toEqual(['moderation']);
    },
  );

  it('refuses a field that is not allowed', async () => {
    expect(
      await invalidFields(ModerateContentDto, 'body', {
        moderation: 'hidden',
        authorId: 'x',
      }),
    ).toEqual(['authorId']);
  });
});
