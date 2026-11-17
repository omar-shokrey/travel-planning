import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ReportStatus } from '../../reports/enums/report-status.enum';
import { ReportTargetType } from '../../reports/enums/report-target-type.enum';
import { ListReportsQueryDto } from './list-reports-query.dto';

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

describe('ListReportsQueryDto (GEN-10)', () => {
  it('lists the first page of 10 open reports of every type by default', async () => {
    const dto = await parse(ListReportsQueryDto, 'query', {});

    expect(dto).toBeInstanceOf(ListReportsQueryDto);
    expect(dto).toMatchObject({ page: 1, limit: 10, status: 'open' });
    expect(dto.targetType).toBeUndefined();
    expect(dto.skip).toBe(0);
  });

  it('reads the status, the target type and the page from the query string', async () => {
    const dto = await parse(ListReportsQueryDto, 'query', {
      page: '2',
      limit: '5',
      status: 'dismissed',
      targetType: 'itinerary',
    });

    expect(dto).toMatchObject({
      page: 2,
      limit: 5,
      status: ReportStatus.Dismissed,
      targetType: ReportTargetType.Itinerary,
    });
    expect(dto.skip).toBe(5);
  });

  it.each([
    ['an unknown status', { status: 'closed' }, ['status']],
    ['an empty status', { status: '' }, ['status']],
    ['an unknown target type', { targetType: 'comment' }, ['targetType']],
    ['a page size over 50', { limit: '51' }, ['limit']],
    ['page 0', { page: '0' }, ['page']],
    ['a parameter that is not allowed', { reporterId: 'x' }, ['reporterId']],
  ] as [string, Record<string, unknown>, string[]][])(
    'rejects %s',
    async (_label, query, fields) => {
      expect(await invalidFields(ListReportsQueryDto, 'query', query)).toEqual(
        fields,
      );
    },
  );
});
