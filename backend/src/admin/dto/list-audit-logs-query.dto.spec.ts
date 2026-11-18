import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ListAuditLogsQueryDto } from './list-audit-logs-query.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: ListAuditLogsQueryDto,
};

const parse = (
  query: Record<string, unknown>,
): Promise<ListAuditLogsQueryDto> =>
  pipe.transform(query, metadata) as Promise<ListAuditLogsQueryDto>;

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

const ID = '6740f1c2a4b5c6d7e8f90123';

describe('ListAuditLogsQueryDto (GEN-07)', () => {
  it('lists the first page of 10 with no filter by default', async () => {
    const dto = await parse({});

    expect(dto).toBeInstanceOf(ListAuditLogsQueryDto);
    expect(dto).toMatchObject({ page: 1, limit: 10 });
    expect(dto.action).toBeUndefined();
    expect(dto.adminId).toBeUndefined();
    expect(dto.targetType).toBeUndefined();
    expect(dto.targetId).toBeUndefined();
  });

  it('accepts every filter together', async () => {
    const dto = await parse({
      page: '2',
      limit: '5',
      action: 'reset_password',
      adminId: ID,
      targetType: 'user',
      targetId: ID,
    });

    expect(dto).toMatchObject({
      page: 2,
      limit: 5,
      action: 'reset_password',
      adminId: ID,
      targetType: 'user',
      targetId: ID,
    });
  });

  it.each([
    ['action', 'drop_database'],
    ['targetType', 'airport'],
    ['adminId', 'not-an-id'],
    ['targetId', '123'],
    ['limit', '51'],
    ['page', '0'],
  ])('rejects an invalid %s', async (field, value) => {
    expect(await invalidFields({ [field]: value })).toEqual([field]);
  });

  it('rejects a parameter that is not allowed', async () => {
    expect(await invalidFields({ details: 'x' })).toEqual(['details']);
  });
});
