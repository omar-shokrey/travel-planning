import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRoomDto } from './update-room.dto';

const messages = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateRoomDto, body))).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('UpdateRoomDto (HTL-05)', () => {
  it('accepts all three fields', async () => {
    expect(
      await messages({ beds: 3, maxOccupancy: 4, pricePerNight: 15000 }),
    ).toEqual([]);
  });

  it('accepts one field, because the others keep their value', async () => {
    expect(await messages({ pricePerNight: 15000 })).toEqual([]);
  });

  it('accepts the lowest values: 1 bed, 1 guest and a price of 1', async () => {
    expect(
      await messages({ beds: 1, maxOccupancy: 1, pricePerNight: 1 }),
    ).toEqual([]);
  });

  it('rejects an occupancy below 1', async () => {
    expect(await messages({ maxOccupancy: 0 })).toEqual([
      'maxOccupancy must be at least 1',
    ]);
  });

  it('rejects a price of 0 and a negative price', async () => {
    expect(await messages({ pricePerNight: 0 })).toEqual([
      'pricePerNight must be more than 0',
    ]);
    expect(await messages({ pricePerNight: -500 })).toEqual([
      'pricePerNight must be more than 0',
    ]);
  });

  it('rejects a price that is not a whole number of minor units', async () => {
    expect(await messages({ pricePerNight: 125.5 })).toEqual([
      'pricePerNight must be a whole number of minor units',
    ]);
  });

  it('rejects beds that are not a whole number of 1 or more', async () => {
    expect(await messages({ beds: 0 })).toEqual(['beds must be at least 1']);
    expect(await messages({ beds: 1.5 })).toEqual([
      'beds must be a whole number',
    ]);
  });

  it('rejects a number sent as text', async () => {
    expect(await messages({ beds: '2' })).toContain(
      'beds must be a whole number',
    );
  });

  it('rejects null, because no room field may be empty', async () => {
    expect(await messages({ beds: null })).toContain(
      'beds must be a whole number',
    );
    expect(await messages({ maxOccupancy: null })).toContain(
      'maxOccupancy must be a whole number',
    );
    expect(await messages({ pricePerNight: null })).toContain(
      'pricePerNight must be a whole number of minor units',
    );
  });
});
