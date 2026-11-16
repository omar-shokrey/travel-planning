import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ACCOUNT_SEARCH_MAX_LENGTH } from '../admin.constants';
import { ListAccountsQueryDto } from './list-accounts-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ListAccountsQueryDto,
};

const parse = (query: Record<string, unknown>): Promise<ListAccountsQueryDto> =>
  pipe.transform(query, metadata) as Promise<ListAccountsQueryDto>;

/** The fields the pipe rejects. Empty when the query is valid. */
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

describe('ListAccountsQueryDto (ACC-14)', () => {
  it('lists the first page of 10 with no search and no filter by default', async () => {
    const dto = await parse({});

    expect(dto).toBeInstanceOf(ListAccountsQueryDto);
    expect(dto).toMatchObject({ page: 1, limit: 10 });
    expect(dto.search).toBeUndefined();
    expect(dto.role).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });

  it('reads the page, the search, the role and the status from the query string', async () => {
    const dto = await parse({
      page: '2',
      limit: '20',
      search: 'sara',
      role: 'hotel_moderator',
      status: 'suspended',
    });

    expect(dto).toMatchObject({
      page: 2,
      limit: 20,
      search: 'sara',
      role: Role.HotelModerator,
      status: UserStatus.Suspended,
    });
  });

  it('trims the search, and treats a blank search as no search', async () => {
    expect((await parse({ search: '  Sara Ahmed ' })).search).toBe(
      'Sara Ahmed',
    );
    expect((await parse({ search: '   ' })).search).toBeUndefined();
  });

  it.each([
    ['a role that does not exist', { role: 'guest' }, ['role']],
    ['a status that does not exist', { status: 'banned' }, ['status']],
    [
      'a search longer than the limit',
      { search: 'a'.repeat(ACCOUNT_SEARCH_MAX_LENGTH + 1) },
      ['search'],
    ],
    ['two searches', { search: ['a', 'b'] }, ['search']],
    ['a page size over 50', { limit: '51' }, ['limit']],
    ['a parameter that is not allowed', { sort: 'name' }, ['sort']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_name, query, fields) => {
      expect(await invalidFields(query)).toEqual(fields);
    },
  );
});
