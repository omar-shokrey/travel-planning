import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../interfaces/error-response.interface';
import { validationExceptionFactory } from '../pipes/validation-exception.factory';
import { MAX_PAGE, PaginationQueryDto } from './pagination-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: PaginationQueryDto,
};

/**
 * Every list DTO of the project extends PaginationQueryDto, so the sent-`skip`
 * case must also be tried on a subclass: that is where class-transformer used
 * to throw.
 */
class ListQueryDto extends PaginationQueryDto {}

async function errorsOf(
  query: unknown,
  metatype: typeof PaginationQueryDto = PaginationQueryDto,
): Promise<FieldError[]> {
  try {
    await pipe.transform(query, { type: 'query', metatype });
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('PaginationQueryDto', () => {
  it('starts at page 1 with 10 items per page (GEN-05)', async () => {
    const query = (await pipe.transform({}, metadata)) as PaginationQueryDto;

    expect(query.page).toBe(1);
    expect(query.limit).toBe(10);
    expect(query.skip).toBe(0);
  });

  it('turns the query strings into numbers and computes skip', async () => {
    const query = (await pipe.transform(
      { page: '3', limit: '20' },
      metadata,
    )) as PaginationQueryDto;

    expect(query.page).toBe(3);
    expect(query.limit).toBe(20);
    expect(query.skip).toBe(40);
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: 'abc' },
    { limit: '0' },
    { limit: '51' },
    { sort: 'price' },
    { page: String(MAX_PAGE + 1) },
    { page: '1e20' },
    { skip: '5' },
  ])('rejects %j', async (query) => {
    await expect(pipe.transform(query, metadata)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts the highest page and computes its skip', async () => {
    const query = (await pipe.transform(
      { page: String(MAX_PAGE), limit: '50' },
      metadata,
    )) as PaginationQueryDto;

    expect(query.page).toBe(MAX_PAGE);
    expect(query.skip).toBe((MAX_PAGE - 1) * 50);
    expect(Number.isSafeInteger(query.skip)).toBe(true);
  });

  it('refuses a page above the highest with a message for page', async () => {
    expect(await errorsOf({ page: '1e20' })).toEqual([
      { field: 'page', messages: ['page is too large'] },
    ]);
    expect(await errorsOf({ page: String(MAX_PAGE + 1) })).toEqual([
      { field: 'page', messages: ['page is too large'] },
    ]);
  });

  describe('skip: computed by the server, never sent', () => {
    it.each([
      ['PaginationQueryDto', PaginationQueryDto],
      ['a list DTO that extends it', ListQueryDto],
    ])('refuses a sent skip on %s with 400, not a crash', async (_, type) => {
      expect(await errorsOf({ skip: '5' }, type)).toEqual([
        { field: 'skip', messages: ['property skip should not exist'] },
      ]);
    });

    it('reports a sent skip in the same answer as the other errors', async () => {
      const errors = await errorsOf(
        { skip: '5', page: '0', sort: 'price' },
        ListQueryDto,
      );

      expect(errors.map((error) => error.field).sort()).toEqual([
        'page',
        'skip',
        'sort',
      ]);
    });

    it('still computes skip from page and limit on a list DTO', async () => {
      const query = (await pipe.transform(
        { page: '3', limit: '5' },
        { type: 'query', metatype: ListQueryDto },
      )) as ListQueryDto;

      expect(query.skip).toBe(10);
      expect(Object.keys(query)).not.toContain('skip');
    });
  });
});
