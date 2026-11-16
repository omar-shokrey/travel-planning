import { model, Types } from 'mongoose';
import { RoomNightState } from './room-night-state.enum';
import { RoomNightSchema } from './room-night.schema';

// Validation runs in memory: no database is opened.
const RoomNightModel = model('RoomNightSchemaSpec', RoomNightSchema);

const night = (fields: Record<string, unknown> = {}) =>
  new RoomNightModel({
    roomId: new Types.ObjectId(),
    hotelId: new Types.ObjectId(),
    date: '2026-12-03',
    state: RoomNightState.Booked,
    ...fields,
  });

describe('RoomNight schema', () => {
  it('is stored in the room_nights collection', () => {
    expect(RoomNightModel.collection.collectionName).toBe('room_nights');
  });

  it('accepts a booked night', () => {
    expect(night().validateSync()).toBeUndefined();
  });

  it('accepts a held night with the moment its hold ends', () => {
    const held = night({
      state: RoomNightState.Held,
      bookingId: new Types.ObjectId(),
      holdExpiresAt: new Date('2026-11-17T10:10:00.000Z'),
    });

    expect(held.validateSync()).toBeUndefined();
  });

  it('accepts a blocked night without a reservation', () => {
    expect(
      night({ state: RoomNightState.Blocked }).validateSync(),
    ).toBeUndefined();
  });

  it('rejects a state that is not held, booked or blocked', () => {
    const errors = night({ state: 'cleaning' }).validateSync()?.errors;

    expect(Object.keys(errors ?? {})).toEqual(['state']);
  });

  it('rejects a date that is not YYYY-MM-DD', () => {
    const errors = night({ date: '03/12/2026' }).validateSync()?.errors;

    expect(Object.keys(errors ?? {})).toEqual(['date']);
  });

  it('requires the room, the hotel, the date and the state', () => {
    const errors = new RoomNightModel({}).validateSync()?.errors;

    expect(Object.keys(errors ?? {}).sort()).toEqual([
      'date',
      'hotelId',
      'roomId',
      'state',
    ]);
  });

  it('allows one document per room and night', () => {
    const indexes = RoomNightSchema.indexes();

    expect(indexes).toContainEqual([
      { roomId: 1, date: 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([
      { hotelId: 1, date: 1 },
      expect.anything(),
    ]);
  });
});
