import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { PostPageQueryDto } from './post-page-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: PostPageQueryDto,
};

const parse = (query: Record<string, unknown>): Promise<PostPageQueryDto> =>
  pipe.transform(query, metadata) as Promise<PostPageQueryDto>;

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

describe('PostPageQueryDto (BLG-02)', () => {
  it('defaults the comments to page 1 with 10 items', async () => {
    const dto = await parse({});

    expect(dto).toMatchObject({ commentsPage: 1, commentsLimit: 10 });
  });

  it('reads the page and the page size as numbers', async () => {
    const dto = await parse({ commentsPage: '3', commentsLimit: '50' });

    expect(dto).toMatchObject({ commentsPage: 3, commentsLimit: 50 });
  });

  it('accepts the smallest page and page size', async () => {
    expect(
      await invalidFields({ commentsPage: '1', commentsLimit: '1' }),
    ).toEqual([]);
  });

  it('gives the comments service its own page, with the skip it needs', async () => {
    const dto = await parse({ commentsPage: '3', commentsLimit: '5' });

    const pagination = dto.commentsPagination();

    expect(pagination).toBeInstanceOf(PaginationQueryDto);
    expect(pagination).toMatchObject({ page: 3, limit: 5 });
    expect(pagination.skip).toBe(10);
  });

  it.each([
    ['page 0', { commentsPage: '0' }, ['commentsPage']],
    ['a negative page', { commentsPage: '-1' }, ['commentsPage']],
    ['a page that is not whole', { commentsPage: '1.5' }, ['commentsPage']],
    ['a page that is text', { commentsPage: 'two' }, ['commentsPage']],
    ['page size 0', { commentsLimit: '0' }, ['commentsLimit']],
    ['a negative page size', { commentsLimit: '-1' }, ['commentsLimit']],
    [
      'a page size that is not whole',
      { commentsLimit: '1.5' },
      ['commentsLimit'],
    ],
    ['a page size that is text', { commentsLimit: 'many' }, ['commentsLimit']],
    ['a page size above 50', { commentsLimit: '51' }, ['commentsLimit']],
    [
      'a bad page and a bad page size together',
      { commentsPage: '0', commentsLimit: '51' },
      ['commentsLimit', 'commentsPage'],
    ],
    ['an unknown parameter', { sort: 'likes' }, ['sort']],
    // The comments have their own names: the plain ones are not parameters.
    ['`page`, which is not a parameter here', { page: '2' }, ['page']],
    ['`limit`, which is not a parameter here', { limit: '5' }, ['limit']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_label, query, fields) => {
      expect(await invalidFields(query)).toEqual(fields);
    },
  );
});
