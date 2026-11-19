import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { BookingType } from '../enums/booking-type.enum';
import { BookingPathDto } from './booking-path.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'param', metatype: BookingPathDto };

async function errorsOf(params: unknown): Promise<FieldError[]> {
  try {
    await pipe.transform(params, metadata);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('BookingPathDto (PAY-02)', () => {
  it.each(Object.values(BookingType))('accepts the type %s', async (type) => {
    const path = (await pipe.transform(
      { type, id: '6740f1c2a4b5c6d7e8f90789' },
      metadata,
    )) as BookingPathDto;

    expect(path).toBeInstanceOf(BookingPathDto);
    expect(path).toEqual({ type, id: '6740f1c2a4b5c6d7e8f90789' });
  });

  it('refuses another type', async () => {
    expect(
      await errorsOf({ type: 'car', id: '6740f1c2a4b5c6d7e8f90789' }),
    ).toEqual([
      { field: 'type', messages: ['type must be one of: flight, hotel'] },
    ]);
  });

  it('refuses a bad id', async () => {
    expect(await errorsOf({ type: 'hotel', id: 'abc' })).toEqual([
      { field: 'id', messages: ['id must be a valid id'] },
    ]);
  });
});
