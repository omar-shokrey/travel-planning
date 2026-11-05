import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../pipes/validation-exception.factory';
import { PaginationQueryDto } from './pagination-query.dto';

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
  ])('rejects %j', async (query) => {
    await expect(pipe.transform(query, metadata)).rejects.toThrow(
      BadRequestException,
    );
  });
});
