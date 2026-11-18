import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { POST_SEARCH_MAX_LENGTH } from '../blog.constants';
import { SearchPostsQueryDto } from './search-posts-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: SearchPostsQueryDto,
};

const parse = (query: Record<string, unknown>): Promise<SearchPostsQueryDto> =>
  pipe.transform(query, metadata) as Promise<SearchPostsQueryDto>;

async function invalidFields(
  query: Record<string, unknown>,
): Promise<string[]> {
  try {
    await parse(query);
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

describe('SearchPostsQueryDto (BLG-09)', () => {
  it('accepts no keyword and keeps the page defaults', async () => {
    const dto = await parse({});

    expect(dto.q).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it('trims the keyword and reads the page as numbers', async () => {
    const dto = await parse({ q: '  Cairo  ', page: '2', limit: '5' });

    expect(dto).toMatchObject({ q: 'Cairo', page: 2, limit: 5 });
  });

  it(`accepts a keyword of ${POST_SEARCH_MAX_LENGTH} characters and keeps regex characters as text`, async () => {
    expect(
      await invalidFields({ q: 'a'.repeat(POST_SEARCH_MAX_LENGTH) }),
    ).toEqual([]);
    expect((await parse({ q: '.*(' })).q).toBe('.*(');
  });

  it.each([
    ['an empty keyword', { q: '' }, ['q']],
    ['a keyword of spaces only', { q: '   ' }, ['q']],
    [
      'a keyword that is too long',
      { q: 'a'.repeat(POST_SEARCH_MAX_LENGTH + 1) },
      ['q'],
    ],
    ['a keyword sent twice', { q: ['a', 'b'] }, ['q']],
    ['a keyword with a null byte', { q: 'a\u0000b' }, ['q']],
    ['a keyword with a line break', { q: 'a\nb' }, ['q']],
    ['a page size above 50', { limit: '51' }, ['limit']],
    ['an unknown parameter', { sort: 'likes' }, ['sort']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_label, query, fields) => {
      expect(await invalidFields(query)).toEqual(fields);
    },
  );
});
