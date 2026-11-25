import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import {
  EXPECTED_DIFFERENCE_REQUIRED_MESSAGE,
  POLICIES_REQUIRED_MESSAGE,
} from '../flight-bookings.constants';
import { ChangeFlightDto } from './change-flight.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = { type: 'body', metatype: ChangeFlightDto };

async function errorsOf(body: unknown): Promise<FieldError[]> {
  try {
    await pipe.transform(body, metadata);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const FLIGHT = '6740f1c2a4b5c6d7e8f90abc';
const change = {
  newFlightId: FLIGHT,
  expectedDifference: 4200,
  policiesAccepted: true,
};

describe('ChangeFlightDto (FLT-27)', () => {
  it('accepts a dry run with only the new flight, and a change with the difference and the policies', async () => {
    expect(await errorsOf({ newFlightId: FLIGHT, dryRun: true })).toEqual([]);
    expect(
      await errorsOf({ newFlightId: FLIGHT, dryRun: true, segmentIndex: 1 }),
    ).toEqual([]);
    expect(await errorsOf(change)).toEqual([]);
    expect(await errorsOf({ ...change, dryRun: false })).toEqual([]);
    expect(await errorsOf({ ...change, expectedDifference: -4005 })).toEqual(
      [],
    );
    expect(await errorsOf({ ...change, expectedDifference: 0 })).toEqual([]);
  });

  it('requires the expected difference and accepted policies to make the change', async () => {
    expect(await errorsOf({ newFlightId: FLIGHT })).toEqual([
      {
        field: 'expectedDifference',
        messages: [
          EXPECTED_DIFFERENCE_REQUIRED_MESSAGE,
          'expectedDifference must be a whole number',
        ],
      },
      { field: 'policiesAccepted', messages: [POLICIES_REQUIRED_MESSAGE] },
    ]);
    expect(await errorsOf({ ...change, policiesAccepted: false })).toEqual([
      { field: 'policiesAccepted', messages: [POLICIES_REQUIRED_MESSAGE] },
    ]);
  });

  it.each([
    ['a bad flight id', { newFlightId: 'abc' }, 'newFlightId'],
    ['no flight', { newFlightId: undefined }, 'newFlightId'],
    [
      'a fractional difference',
      { expectedDifference: 1.5 },
      'expectedDifference',
    ],
    ['a segment of 2', { segmentIndex: 2 }, 'segmentIndex'],
    ['a negative segment', { segmentIndex: -1 }, 'segmentIndex'],
    ['a null segment', { segmentIndex: null }, 'segmentIndex'],
    ['a dry run that is not a boolean', { dryRun: 'yes' }, 'dryRun'],
    ['a null dry run', { dryRun: null }, 'dryRun'],
  ])('refuses %s', async (_name, fields, field) => {
    const errors = await errorsOf({ ...change, ...fields });

    expect(errors.map((error) => error.field)).toContain(field);
  });

  it.each([
    ['cabin', 'business'],
    ['price', 1],
    ['difference', 0],
    ['status', 'completed'],
    ['userId', '6740f1c2a4b5c6d7e8f90123'],
  ])('refuses %s, which the server sets', async (field, value) => {
    expect(await errorsOf({ ...change, [field]: value })).toEqual([
      { field, messages: [`property ${field} should not exist`] },
    ]);
  });
});
