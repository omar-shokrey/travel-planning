import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ReportTargetType } from '../enums/report-target-type.enum';
import { REPORT_REASON_MAX_LENGTH } from '../reports.constants';
import { CreateReportDto } from './create-report.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const metadata: ArgumentMetadata = { type: 'body', metatype: CreateReportDto };

const valid = {
  targetType: ReportTargetType.Post,
  targetId: '6745a1b2c3d4e5f6a7b8c9d0',
  reason: 'Spam links',
};

const parse = (body: Record<string, unknown>): Promise<CreateReportDto> =>
  pipe.transform(body, metadata) as Promise<CreateReportDto>;

async function invalidFields(body: Record<string, unknown>): Promise<string[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    const { errors } = error.getResponse() as { errors: FieldError[] };
    return errors.map(({ field }) => field).sort();
  }
}

describe('CreateReportDto (GEN-09)', () => {
  it('accepts a post report and an itinerary report', async () => {
    expect(await parse(valid)).toEqual(valid);
    expect(
      await parse({ ...valid, targetType: ReportTargetType.Itinerary }),
    ).toEqual({ ...valid, targetType: 'itinerary' });
  });

  it('trims the reason', async () => {
    const dto = await parse({ ...valid, reason: '  Spam links  ' });

    expect(dto.reason).toBe('Spam links');
  });

  it(`accepts a reason of exactly ${REPORT_REASON_MAX_LENGTH} characters`, async () => {
    const reason = 'a'.repeat(REPORT_REASON_MAX_LENGTH);

    expect((await parse({ ...valid, reason })).reason).toBe(reason);
  });

  it.each([
    ['targetType', undefined],
    ['targetType', null],
    ['targetType', 'comment'],
    ['targetType', 'review'],
    ['targetId', undefined],
    ['targetId', null],
    ['targetId', 'not-an-id'],
    ['targetId', 12],
    ['reason', undefined],
    ['reason', null],
    ['reason', ''],
    ['reason', '   '],
    ['reason', 42],
    ['reason', 'a'.repeat(REPORT_REASON_MAX_LENGTH + 1)],
  ])('refuses %s = %p', async (field, value) => {
    expect(await invalidFields({ ...valid, [field]: value })).toEqual([field]);
  });

  it.each(['reporterId', 'status', 'createdAt'])(
    'refuses the server-set field %s',
    async (field) => {
      expect(await invalidFields({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );
});
