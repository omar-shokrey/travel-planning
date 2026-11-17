import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { CreateHotelBookingDto } from './create-hotel-booking.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateHotelBookingDto,
};

const HOTEL = '6740f1c2a4b5c6d7e8f90123';
const ROOM_A = '6740f1c2a4b5c6d7e8f90456';
const ROOM_B = '6740f1c2a4b5c6d7e8f90457';

const valid = {
  hotelId: HOTEL,
  checkIn: '2026-12-10',
  checkOut: '2026-12-13',
  rooms: [{ roomId: ROOM_A, adults: 2, childAges: [7] }],
  acceptPolicies: true,
};

const parse = (body: object) =>
  pipe.transform(body, metadata) as Promise<CreateHotelBookingDto>;

/** The fields named in the 400 answer. */
const failedFields = async (body: object): Promise<string[]> => {
  try {
    await parse(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      errors: { field: string }[];
    };
    return response.errors.map((entry) => entry.field);
  }
  throw new Error('The body was accepted');
};

/** Every message of the 400 answer. */
const messages = async (body: object): Promise<string[]> => {
  try {
    await parse(body);
  } catch (error) {
    const response = (error as BadRequestException).getResponse() as {
      errors: { messages: string[] }[];
    };
    return response.errors.flatMap((entry) => entry.messages);
  }
  throw new Error('The body was accepted');
};

describe('CreateHotelBookingDto (HTL-16, HTL-18, PAY-02)', () => {
  it('accepts a reservation of one room with an adult and a child', async () => {
    const dto = await parse(valid);

    expect(dto).toMatchObject(valid);
  });

  it('accepts several rooms, one of them with children only', async () => {
    const dto = await parse({
      ...valid,
      rooms: [
        { roomId: ROOM_A, adults: 1 },
        { roomId: ROOM_B, adults: 0, childAges: [0, 17] },
      ],
    });

    expect(dto.rooms).toEqual([
      { roomId: ROOM_A, adults: 1, childAges: [] },
      { roomId: ROOM_B, adults: 0, childAges: [0, 17] },
    ]);
  });

  it('keeps a room id in lower case', async () => {
    const dto = await parse({
      ...valid,
      rooms: [{ roomId: ROOM_A.toUpperCase(), adults: 1 }],
    });

    expect(dto.rooms[0].roomId).toBe(ROOM_A);
  });

  it('refuses a reservation without any adult', async () => {
    expect(
      await messages({
        ...valid,
        rooms: [{ roomId: ROOM_A, adults: 0, childAges: [5] }],
      }),
    ).toContain('A reservation needs at least one adult');
  });

  it('refuses a room without any guest', async () => {
    expect(
      await messages({
        ...valid,
        rooms: [
          { roomId: ROOM_A, adults: 2 },
          { roomId: ROOM_B, adults: 0 },
        ],
      }),
    ).toContain('Each room needs at least one guest');
  });

  it('refuses the same room twice, in any letter case', async () => {
    expect(
      await messages({
        ...valid,
        rooms: [
          { roomId: ROOM_A, adults: 1 },
          { roomId: ROOM_A.toUpperCase(), adults: 1 },
        ],
      }),
    ).toContain('Each room can be chosen only once');
  });

  it('refuses a reservation without the policies accepted', async () => {
    for (const acceptPolicies of [false, undefined, 'true']) {
      expect(await failedFields({ ...valid, acceptPolicies })).toEqual([
        'acceptPolicies',
      ]);
    }
  });

  it.each([
    ['no rooms', { rooms: [] }, 'rooms'],
    [
      'eleven rooms',
      {
        rooms: Array.from({ length: 11 }, (_, index) => ({
          roomId: `6740f1c2a4b5c6d7e8f904${10 + index}`,
          adults: 1,
        })),
      },
      'rooms',
    ],
    ['rooms that is not a list', { rooms: { roomId: ROOM_A } }, 'rooms'],
    ['a room that is a list', { rooms: [[ROOM_A]] }, 'rooms'],
    ['a bad hotel id', { hotelId: 'nile' }, 'hotelId'],
    [
      'a bad room id',
      { rooms: [{ roomId: 'x', adults: 1 }] },
      'rooms.0.roomId',
    ],
    [
      'a negative number of adults',
      { rooms: [{ roomId: ROOM_A, adults: -1, childAges: [3] }] },
      'rooms.0.adults',
    ],
    [
      'adults that are not whole',
      { rooms: [{ roomId: ROOM_A, adults: 1.5 }] },
      'rooms.0.adults',
    ],
    [
      'a child of 18',
      { rooms: [{ roomId: ROOM_A, adults: 1, childAges: [18] }] },
      'rooms.0.childAges',
    ],
    [
      'a negative child age',
      { rooms: [{ roomId: ROOM_A, adults: 1, childAges: [-1] }] },
      'rooms.0.childAges',
    ],
    [
      'a check-out before check-in',
      { checkIn: '2026-12-13', checkOut: '2026-12-10' },
      'checkIn',
    ],
    ['a date that does not exist', { checkOut: '2026-02-30' }, 'checkOut'],
  ])('refuses %s', async (_, change, field) => {
    expect(await failedFields({ ...valid, ...change })).toContain(field);
  });

  it.each(['status', 'total', 'userId', 'holdExpiresAt', 'reference'])(
    'refuses the server field %s',
    async (field) => {
      expect(await failedFields({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );

  it('refuses a price sent for a room', async () => {
    expect(
      await failedFields({
        ...valid,
        rooms: [{ roomId: ROOM_A, adults: 1, pricePerNight: 1 }],
      }),
    ).toEqual(['rooms.0.pricePerNight']);
  });
});
