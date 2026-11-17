import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateRoomAvailabilityDto } from './create-room-availability.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const valid = {
  from: '2026-12-01',
  to: '2026-12-08',
};

const parse = (body: Record<string, unknown>) =>
  pipe.transform(body, {
    type: 'body',
    metatype: CreateRoomAvailabilityDto,
  } as ArgumentMetadata) as Promise<CreateRoomAvailabilityDto>;

async function errorsOf(body: Record<string, unknown>): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('CreateRoomAvailabilityDto (HTL-04)', () => {
  it('accepts date-only ranges with the end boundary after the start', async () => {
    const dto = await parse(valid);

    expect(dto).toBeInstanceOf(CreateRoomAvailabilityDto);
    expect(dto).toEqual(valid);
  });

  it.each([
    [{ from: '2026-12-08', to: '2026-12-01' }, 'from'],
    [{ from: '2026-12-01', to: '2026-12-01' }, 'from'],
    [{ from: '2026-02-30', to: '2026-03-08' }, 'from'],
    [{ from: '2026-12-01T00:00:00Z', to: '2026-12-08' }, 'from'],
    [{ from: '2026-12-01', to: '2026-12-08T00:00:00Z' }, 'to'],
    [{ from: '', to: '2026-12-08' }, 'from'],
    [{ from: '2026-12-01', to: '' }, 'to'],
  ])('rejects invalid availability range %j', async (body, field) => {
    expect((await errorsOf(body)).map(({ field }) => field)).toContain(field);
  });

  it('rejects unknown fields', async () => {
    expect(
      (await errorsOf({ ...valid, roomId: '6740f1c2a4b5c6d7e8f90123' })).map(
        ({ field }) => field,
      ),
    ).toEqual(['roomId']);
  });
});
