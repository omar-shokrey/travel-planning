import { Mongoose, Types } from 'mongoose';
import { Room, RoomSchema } from './room.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const RoomModel = mongoose.model(Room.name, RoomSchema);

const valid = {
  hotelId: new Types.ObjectId(),
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
  availability: [],
};

const validAvailability = {
  from: '2026-12-01',
  to: '2026-12-08',
};

const invalidFields = (data: Record<string, unknown>): Promise<string[]> =>
  new RoomModel(data).validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

describe('Room model (HTL-03, HTL-04)', () => {
  it('sets active by default and stores timestamps', () => {
    const room = new RoomModel(valid);

    expect(room.active).toBe(true);
    expect(RoomSchema.options.timestamps).toBe(true);
  });

  it('trims the room number and type', () => {
    const room = new RoomModel({ ...valid, number: ' 101 ', type: ' Double ' });

    expect(room.number).toBe('101');
    expect(room.type).toBe('Double');
  });

  it('defaults room availability to an empty array', () => {
    expect(new RoomModel(valid).availability).toEqual([]);
  });

  it('accepts a valid date-only availability range', async () => {
    expect(
      await invalidFields({
        ...valid,
        availability: [validAvailability],
      }),
    ).toEqual([]);
  });

  it.each([
    [{ from: '2026-12-01T00:00:00Z', to: '2026-12-08' }, 'from'],
    [{ from: '2026-12-01', to: '2026-12-08T00:00:00Z' }, 'to'],
    [{ from: '2026-12-08', to: '2026-12-01' }, 'to'],
  ])('rejects invalid availability range %j', async (range, field) => {
    expect(
      await invalidFields({
        ...valid,
        availability: [range],
      }),
    ).toContain(`availability.0.${field}`);
  });

  it.each([
    ['beds', 0],
    ['beds', 1.5],
    ['maxOccupancy', 0],
    ['maxOccupancy', 1.5],
    ['pricePerNight', 0],
    ['pricePerNight', 1.5],
  ])('rejects invalid %s value %s', async (field, value) => {
    expect(await invalidFields({ ...valid, [field]: value })).toContain(field);
  });

  it('requires the hotel and room details', async () => {
    expect(await invalidFields({})).toEqual([
      'beds',
      'hotelId',
      'maxOccupancy',
      'number',
      'pricePerNight',
      'type',
    ]);
  });

  it('enforces a unique room number within a hotel', () => {
    expect(RoomSchema.indexes()).toContainEqual([
      { hotelId: 1, number: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });
});
