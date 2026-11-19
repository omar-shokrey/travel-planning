import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { HoldFlightBookingDto } from './hold-flight-booking.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: HoldFlightBookingDto,
};

/** A date `days` from today (UTC). */
const day = (days: number): string =>
  DateTime.utc().plus({ days }).toISODate() as string;

const passenger = (fields: Record<string, unknown> = {}) => ({
  fullName: 'Sara Ahmed',
  dateOfBirth: '1990-05-14',
  passportNumber: 'A12345678',
  ...fields,
});

const body = (fields: Record<string, unknown> = {}) => ({
  flightId: '6740f1c2a4b5c6d7e8f90456',
  cabin: 'economy',
  passengers: [passenger()],
  ...fields,
});

/** A body with one passenger changed. */
const withPassenger = (fields: Record<string, unknown>) =>
  body({ passengers: [passenger(fields)] });

const parse = (input: unknown): Promise<HoldFlightBookingDto> =>
  pipe.transform(input, metadata) as Promise<HoldFlightBookingDto>;

/** The field errors the pipe answers with. Empty when the body is valid. */
async function errorsOf(input: unknown): Promise<FieldError[]> {
  try {
    await parse(input);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

/** The messages of one field, or fails when another field is refused too. */
async function onlyField(input: unknown, field: string): Promise<string[]> {
  const errors = await errorsOf(input);
  expect(errors.map((error) => error.field)).toEqual([field]);
  return errors[0].messages;
}

describe('HoldFlightBookingDto (FLT-22, FLT-19)', () => {
  it('accepts one adult without extra bags, the Swagger example', async () => {
    const dto = await parse(body());

    expect(dto).toEqual({
      flightId: '6740f1c2a4b5c6d7e8f90456',
      cabin: CabinClass.Economy,
      passengers: [
        {
          fullName: 'Sara Ahmed',
          dateOfBirth: '1990-05-14',
          passportNumber: 'A12345678',
        },
      ],
    });
  });

  it('accepts extra bags, and reads null extra bags as none', async () => {
    const dto = await parse(
      body({
        passengers: [
          passenger({ extraBags: { bags: 2, weightKg: 40 } }),
          passenger({ passportNumber: 'B12345678', extraBags: null }),
        ],
      }),
    );

    expect(dto.passengers[0].extraBags).toEqual({ bags: 2, weightKg: 40 });
    expect(dto.passengers[1].extraBags).toBeNull();
  });

  it('trims the name and trims and upper-cases the passport number', async () => {
    const dto = await parse(
      withPassenger({ fullName: '  Sara Ahmed  ', passportNumber: ' a1234b ' }),
    );

    expect(dto.passengers[0]).toMatchObject({
      fullName: 'Sara Ahmed',
      passportNumber: 'A1234B',
    });
  });

  describe('flight and cabin', () => {
    it.each([
      ['flightId', { flightId: undefined }, 'flightId is required'],
      ['flightId', { flightId: 'abc' }, 'flightId must be a valid id'],
      ['cabin', { cabin: undefined }, 'cabin is required'],
      [
        'cabin',
        { cabin: 'luxury' },
        'cabin must be one of: economy, premium_economy, business, first',
      ],
    ])('refuses %s %j', async (field, fields, message) => {
      expect(await onlyField(body(fields), field)).toContain(message);
    });
  });

  describe('passengers', () => {
    it.each([
      [{ passengers: undefined }, 'passengers is required'],
      [{ passengers: 'two' }, 'passengers must be a list'],
      [{ passengers: [] }, 'passengers must have at least 1 passenger'],
      [
        {
          passengers: Array.from({ length: 19 }, (_, index) =>
            passenger({ passportNumber: `P${10000 + index}` }),
          ),
        },
        'passengers must have at most 18 passengers',
      ],
    ])('refuses %j', async (fields, message) => {
      expect(await onlyField(body(fields), 'passengers')).toContain(message);
    });

    it('refuses a passenger sent as a list', async () => {
      // ValidateNested also walks into the inner list, so that path is
      // reported too; the answer is a 400 either way.
      const errors = await errorsOf(body({ passengers: [['Sara']] }));
      expect(errors).toContainEqual({
        field: 'passengers',
        messages: ['Each passenger must be an object'],
      });
    });

    it('accepts 18 passengers (the derived limits are checked by the service)', async () => {
      await expect(
        parse(
          body({
            passengers: Array.from({ length: 18 }, (_, index) =>
              passenger({ passportNumber: `P${10000 + index}` }),
            ),
          }),
        ),
      ).resolves.toBeDefined();
    });

    it.each(['type', 'price', 'age'])(
      'refuses a server field %s inside a passenger',
      async (field) => {
        const errors = await errorsOf(withPassenger({ [field]: 'adult' }));
        expect(errors.map((error) => error.field)).toEqual([
          `passengers.0.${field}`,
        ]);
      },
    );

    it.each(['price', 'status', 'total', 'baggageTotal', 'userId'])(
      'refuses a server field %s on the booking',
      async (field) => {
        const errors = await errorsOf(body({ [field]: 1 }));
        expect(errors.map((error) => error.field)).toEqual([field]);
      },
    );
  });

  describe('fullName', () => {
    it.each([
      [undefined, 'fullName is required'],
      [12, 'fullName must be text'],
      [' S ', 'fullName must have 2 to 100 characters'],
      ['x'.repeat(101), 'fullName must have 2 to 100 characters'],
    ])('refuses %j', async (fullName, message) => {
      expect(
        await onlyField(withPassenger({ fullName }), 'passengers.0.fullName'),
      ).toContain(message);
    });

    it('accepts 2 and 100 characters', async () => {
      await expect(
        parse(withPassenger({ fullName: 'Al' })),
      ).resolves.toBeDefined();
      await expect(
        parse(withPassenger({ fullName: 'x'.repeat(100) })),
      ).resolves.toBeDefined();
    });
  });

  describe('dateOfBirth', () => {
    it.each([
      [undefined, 'dateOfBirth is required'],
      ['14/05/1990', 'dateOfBirth must be a date in the form YYYY-MM-DD'],
      ['1990-5-14', 'dateOfBirth must be a date in the form YYYY-MM-DD'],
      [
        '1990-05-14T00:00:00Z',
        'dateOfBirth must be a date in the form YYYY-MM-DD',
      ],
      ['1990-13-01', 'dateOfBirth must be a real calendar date'],
      ['1990-04-31', 'dateOfBirth must be a real calendar date'],
      // 2023 is not a leap year.
      ['2023-02-29', 'dateOfBirth must be a real calendar date'],
    ])('refuses %j', async (dateOfBirth, message) => {
      expect(
        await onlyField(
          withPassenger({ dateOfBirth }),
          'passengers.0.dateOfBirth',
        ),
      ).toContain(message);
    });

    it('accepts 29 February of a leap year', async () => {
      await expect(
        parse(withPassenger({ dateOfBirth: '2024-02-29' })),
      ).resolves.toBeDefined();
    });

    it('accepts today and refuses tomorrow', async () => {
      await expect(
        parse(withPassenger({ dateOfBirth: day(0) })),
      ).resolves.toBeDefined();
      expect(
        await onlyField(
          withPassenger({ dateOfBirth: day(1) }),
          'passengers.0.dateOfBirth',
        ),
      ).toEqual([
        'dateOfBirth cannot be in the future or more than 120 years ago',
      ]);
    });

    it('accepts exactly 120 years ago and refuses one day more', async () => {
      const limit = DateTime.utc().minus({ years: 120 });
      await expect(
        parse(withPassenger({ dateOfBirth: limit.toISODate() })),
      ).resolves.toBeDefined();
      expect(
        await onlyField(
          withPassenger({
            dateOfBirth: limit.minus({ days: 1 }).toISODate(),
          }),
          'passengers.0.dateOfBirth',
        ),
      ).toEqual([
        'dateOfBirth cannot be in the future or more than 120 years ago',
      ]);
    });
  });

  describe('passportNumber', () => {
    it.each([
      [undefined, 'passportNumber is required'],
      [12345678, 'passportNumber must be text'],
      ['A123', 'passportNumber must have 5 to 20 characters'],
      ['A'.repeat(21), 'passportNumber must have 5 to 20 characters'],
      ['AB-12345', 'passportNumber must contain only letters and digits'],
      ['AB 12345', 'passportNumber must contain only letters and digits'],
    ])('refuses %j', async (passportNumber, message) => {
      expect(
        await onlyField(
          withPassenger({ passportNumber }),
          'passengers.0.passportNumber',
        ),
      ).toContain(message);
    });

    it('accepts 5 and 20 letters and digits', async () => {
      await expect(
        parse(withPassenger({ passportNumber: 'AB123' })),
      ).resolves.toBeDefined();
      await expect(
        parse(withPassenger({ passportNumber: 'A'.repeat(20) })),
      ).resolves.toBeDefined();
    });
  });

  describe('extraBags', () => {
    it.each([
      [{ weightKg: 10 }, 'passengers.0.extraBags.bags', 'bags is required'],
      [
        { bags: 0, weightKg: 10 },
        'passengers.0.extraBags.bags',
        'bags must be at least 1',
      ],
      [
        { bags: 11, weightKg: 10 },
        'passengers.0.extraBags.bags',
        'bags must be at most 10',
      ],
      [
        { bags: 1.5, weightKg: 10 },
        'passengers.0.extraBags.bags',
        'bags must be a whole number',
      ],
      [{ bags: 1 }, 'passengers.0.extraBags.weightKg', 'weightKg is required'],
      [
        { bags: 1, weightKg: 0 },
        'passengers.0.extraBags.weightKg',
        'weightKg must be at least 1',
      ],
      [
        { bags: 1, weightKg: 9.5 },
        'passengers.0.extraBags.weightKg',
        'weightKg must be a whole number',
      ],
      [
        { bags: 1, weightKg: 9, fee: 1 },
        'passengers.0.extraBags.fee',
        'property fee should not exist',
      ],
    ])('refuses %j', async (extraBags, field, message) => {
      expect(await onlyField(withPassenger({ extraBags }), field)).toContain(
        message,
      );
    });
  });

  it('refuses extra bags sent as a list', async () => {
    const errors = await errorsOf(withPassenger({ extraBags: [1] }));
    expect(errors).toContainEqual({
      field: 'passengers.0.extraBags',
      messages: ['extraBags must be an object'],
    });
  });

  it('never repeats a personal value in a message', async () => {
    const errors = await errorsOf(
      withPassenger({
        fullName: 'Z',
        dateOfBirth: '2999-01-01',
        passportNumber: 'SECRET-99',
      }),
    );

    const text = JSON.stringify(errors);
    expect(errors).toHaveLength(3);
    for (const value of ['SECRET-99', '2999-01-01', '"Z"']) {
      expect(text).not.toContain(value);
    }
  });
});

describe('HoldFlightBookingDto: round trip (FLT-12(a))', () => {
  const RETURN_ID = '6740f1c2a4b5c6d7e8f90789';

  it('accepts a return flight and cabin, and keeps them', async () => {
    const dto = await parse(
      body({ returnFlightId: RETURN_ID, returnCabin: 'business' }),
    );

    expect(dto.returnFlightId).toBe(RETURN_ID);
    expect(dto.returnCabin).toBe(CabinClass.Business);
  });

  it('is one-way without them, also when both are null', async () => {
    expect(await errorsOf(body())).toEqual([]);
    expect(
      await errorsOf(body({ returnFlightId: null, returnCabin: null })),
    ).toEqual([]);
  });

  it('refuses a return flight without its cabin', async () => {
    expect(
      await onlyField(body({ returnFlightId: RETURN_ID }), 'returnCabin'),
    ).toEqual(['returnCabin is required with returnFlightId']);
    expect(
      await onlyField(
        body({ returnFlightId: RETURN_ID, returnCabin: null }),
        'returnCabin',
      ),
    ).toEqual(['returnCabin is required with returnFlightId']);
  });

  it('refuses a return cabin without its flight', async () => {
    expect(
      await onlyField(body({ returnCabin: 'economy' }), 'returnFlightId'),
    ).toEqual(['returnFlightId is required with returnCabin']);
  });

  it.each(['abc', '123', 42, { id: RETURN_ID }])(
    'refuses the return flight id %p',
    async (returnFlightId) => {
      expect(
        await onlyField(
          body({ returnFlightId, returnCabin: 'economy' }),
          'returnFlightId',
        ),
      ).toEqual(['returnFlightId must be a valid id']);
    },
  );

  it.each(['Economy', 'coach', '', 3])(
    'refuses the return cabin %p, naming every cabin',
    async (returnCabin) => {
      expect(
        await onlyField(
          body({ returnFlightId: RETURN_ID, returnCabin }),
          'returnCabin',
        ),
      ).toEqual([
        'returnCabin must be one of: economy, premium_economy, business, first',
      ]);
    },
  );

  describe('returnExtraBags of a passenger', () => {
    const withReturnBags = (returnExtraBags: unknown) =>
      body({
        returnFlightId: RETURN_ID,
        returnCabin: 'economy',
        passengers: [passenger({ returnExtraBags })],
      });

    it('accepts bags and weight, and none (left out or null)', async () => {
      const dto = await parse(withReturnBags({ bags: 2, weightKg: 30 }));

      expect(dto.passengers[0].returnExtraBags).toEqual({
        bags: 2,
        weightKg: 30,
      });
      expect(await errorsOf(withReturnBags(null))).toEqual([]);
      expect(
        await errorsOf(
          body({ returnFlightId: RETURN_ID, returnCabin: 'economy' }),
        ),
      ).toEqual([]);
    });

    it.each([['two'], [5]])(
      'refuses %p, which is not an object',
      async (returnExtraBags) => {
        expect(
          await onlyField(
            withReturnBags(returnExtraBags),
            'passengers.0.returnExtraBags',
          ),
        ).toContain('returnExtraBags must be an object');
      },
    );

    it('refuses return bags sent as a list, as extraBags does', async () => {
      expect(await errorsOf(withReturnBags([1]))).toContainEqual({
        field: 'passengers.0.returnExtraBags',
        messages: ['returnExtraBags must be an object'],
      });
    });

    it('checks bags and weight with the rules of extraBags', async () => {
      expect(
        await onlyField(
          withReturnBags({ bags: 0, weightKg: 10 }),
          'passengers.0.returnExtraBags.bags',
        ),
      ).toEqual(['bags must be at least 1']);
      expect(
        await onlyField(
          withReturnBags({ bags: 1, weightKg: 1.5 }),
          'passengers.0.returnExtraBags.weightKg',
        ),
      ).toEqual(['weightKg must be a whole number']);
      expect(
        await onlyField(
          withReturnBags({ bags: 1 }),
          'passengers.0.returnExtraBags.weightKg',
        ),
      ).toContain('weightKg is required');
    });

    it('refuses a price or fee sent inside it', async () => {
      expect(
        await onlyField(
          withReturnBags({ bags: 1, weightKg: 10, fee: 0 }),
          'passengers.0.returnExtraBags.fee',
        ),
      ).toEqual(['property fee should not exist']);
    });
  });

  it.each(['returnFare', 'returnSeats', 'tripType', 'segments'])(
    'refuses %s: the server decides it',
    async (field) => {
      expect(
        await onlyField(
          body({
            returnFlightId: RETURN_ID,
            returnCabin: 'economy',
            [field]: 1,
          }),
          field,
        ),
      ).toEqual([`property ${field} should not exist`]);
    },
  );
});
