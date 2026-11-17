import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ReportAction } from '../../reports/enums/report-action.enum';
import { ResolveReportDto } from './resolve-report.dto';

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

describe('ResolveReportDto (GEN-10)', () => {
  it.each(Object.values(ReportAction))('accepts %s', async (action) => {
    expect(await parse(ResolveReportDto, 'body', { action })).toEqual({
      action,
    });
  });

  it.each([undefined, null, '', 'approve', 'HIDE', 3])(
    'refuses action = %p',
    async (action) => {
      expect(await invalidFields(ResolveReportDto, 'body', { action })).toEqual(
        ['action'],
      );
    },
  );

  it.each(['status', 'resolvedBy', 'resolvedAt'])(
    'refuses the server-set field %s',
    async (field) => {
      expect(
        await invalidFields(ResolveReportDto, 'body', {
          action: 'dismiss',
          [field]: 'x',
        }),
      ).toEqual([field]);
    },
  );
});
