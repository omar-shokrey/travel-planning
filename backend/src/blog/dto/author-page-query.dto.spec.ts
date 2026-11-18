import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { AuthorPageQueryDto } from './author-page-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: AuthorPageQueryDto,
};

const parse = (query: Record<string, unknown>): Promise<AuthorPageQueryDto> =>
  pipe.transform(query, metadata) as Promise<AuthorPageQueryDto>;

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

describe('AuthorPageQueryDto (BLG-12)', () => {
  it('defaults both lists to page 1 with 10 items', async () => {
    const dto = await parse({});

    expect(dto).toMatchObject({
      postsPage: 1,
      postsLimit: 10,
      itinerariesPage: 1,
      itinerariesLimit: 10,
    });
  });

  it('reads each list page as numbers, on its own', async () => {
    const dto = await parse({
      postsPage: '3',
      postsLimit: '50',
      itinerariesLimit: '1',
    });

    expect(dto).toMatchObject({
      postsPage: 3,
      postsLimit: 50,
      itinerariesPage: 1,
      itinerariesLimit: 1,
    });
  });

  it('gives each list service its own page, with the skip it needs', async () => {
    const dto = await parse({
      postsPage: '3',
      postsLimit: '5',
      itinerariesPage: '2',
      itinerariesLimit: '4',
    });

    const posts = dto.postsPagination();
    const itineraries = dto.itinerariesPagination();

    expect(posts).toBeInstanceOf(PaginationQueryDto);
    expect(posts).toMatchObject({ page: 3, limit: 5, skip: 10 });
    expect(itineraries).toBeInstanceOf(PaginationQueryDto);
    expect(itineraries).toMatchObject({ page: 2, limit: 4, skip: 4 });
  });

  it.each([
    ['a posts page of 0', { postsPage: '0' }, ['postsPage']],
    ['an itineraries page of 0', { itinerariesPage: '0' }, ['itinerariesPage']],
    ['a posts page size of 0', { postsLimit: '0' }, ['postsLimit']],
    ['a posts page size above 50', { postsLimit: '51' }, ['postsLimit']],
    [
      'an itineraries page size above 50',
      { itinerariesLimit: '51' },
      ['itinerariesLimit'],
    ],
    ['a page that is not a whole number', { postsPage: '1.5' }, ['postsPage']],
    [
      'a page that is not a number',
      { itinerariesPage: 'two' },
      ['itinerariesPage'],
    ],
    ['the plain page parameter', { page: '2' }, ['page']],
    ['an unknown parameter', { sort: 'title' }, ['sort']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_label, query, fields) => {
      expect(await invalidFields(query)).toEqual(fields);
    },
  );
});
