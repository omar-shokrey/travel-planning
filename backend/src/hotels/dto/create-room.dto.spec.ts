import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { ROOM_PRICE_MAX } from '../hotels.constants';
import { CreateRoomDto } from './create-room.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});

const valid = {
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
};

const parse = (body: Record<string, unknown>) =>
  pipe.transform(body, {
    type: 'body',
    metatype: CreateRoomDto,
  } as ArgumentMetadata) as Promise<CreateRoomDto>;

async function errorsOf(body: Record<string, unknown>): Promise<FieldError[]> {
  try {
    await parse(body);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

describe('CreateRoomDto (HTL-03)', () => {
  it('accepts a complete room and trims its text fields', async () => {
    const dto = await parse({
      ...valid,
      number: ' 101 ',
      type: ' Double ',
    });

    expect(dto).toBeInstanceOf(CreateRoomDto);
    expect(dto).toMatchObject({ number: '101', type: 'Double' });
  });

  it('rejects missing or blank room details', async () => {
    expect((await errorsOf({})).map(({ field }) => field).sort()).toEqual([
      'beds',
      'maxOccupancy',
      'number',
      'pricePerNight',
      'type',
    ]);
    expect(
      (await errorsOf({ ...valid, number: '  ' })).map(({ field }) => field),
    ).toContain('number');
    expect(
      (await errorsOf({ ...valid, type: '  ' })).map(({ field }) => field),
    ).toContain('type');
  });

  it.each([
    ['beds', 0],
    ['beds', 1.5],
    ['maxOccupancy', 0],
    ['maxOccupancy', 1.5],
    ['pricePerNight', 0],
    ['pricePerNight', 1.5],
  ])('rejects invalid %s value %s', async (field, value) => {
    expect(
      (await errorsOf({ ...valid, [field]: value })).map(({ field }) => field),
    ).toContain(field);
  });

  it('accepts the highest price, ROOM_PRICE_MAX', async () => {
    const dto = await parse({ ...valid, pricePerNight: ROOM_PRICE_MAX });

    expect(dto.pricePerNight).toBe(ROOM_PRICE_MAX);
  });

  it.each([ROOM_PRICE_MAX + 1, 1e300])(
    'rejects the price %s, above ROOM_PRICE_MAX',
    async (pricePerNight) => {
      expect(await errorsOf({ ...valid, pricePerNight })).toEqual([
        {
          field: 'pricePerNight',
          messages: [`pricePerNight must be at most ${ROOM_PRICE_MAX}`],
        },
      ]);
    },
  );

  it.each(['hotelId', 'active'])(
    'does not accept server-controlled field %s',
    async (field) => {
      expect(
        (await errorsOf({ ...valid, [field]: 'value' })).map(
          ({ field }) => field,
        ),
      ).toEqual([field]);
    },
  );
});
