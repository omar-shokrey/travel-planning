import { Types } from 'mongoose';
import { ROOM_PRICE_MAX, ROOM_QUERY_MAX_NIGHTS } from '../hotels.constants';
import { toAvailableRoomResponse } from './available-room.mapper';

const storedRoom = (fields: object = {}) => ({
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90124'),
  hotelId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
  active: true,
  availability: [{ from: '2026-12-01', to: '2026-12-31' }],
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  updatedAt: new Date('2026-11-06T09:30:00.000Z'),
  ...fields,
});

describe('toAvailableRoomResponse (HTL-15)', () => {
  it('returns the public fields of the room and the price of the stay', () => {
    expect(toAvailableRoomResponse(storedRoom(), 3)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90124',
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      nights: 3,
      totalPrice: 37500,
      currency: 'USD',
    });
  });

  it('returns exactly these keys: nothing internal leaves the API', () => {
    expect(
      Object.keys(toAvailableRoomResponse(storedRoom(), 3)).sort(),
    ).toEqual([
      'beds',
      'currency',
      'id',
      'maxOccupancy',
      'nights',
      'number',
      'pricePerNight',
      'totalPrice',
      'type',
    ]);
  });

  it('prices one night at the price per night', () => {
    expect(
      toAvailableRoomResponse(storedRoom({ pricePerNight: 9999 }), 1),
    ).toMatchObject({ nights: 1, totalPrice: 9999 });
  });

  it('keeps the largest total a safe whole number', () => {
    const room = toAvailableRoomResponse(
      storedRoom({ pricePerNight: ROOM_PRICE_MAX }),
      ROOM_QUERY_MAX_NIGHTS,
    );

    expect(room.totalPrice).toBe(366_000_000_000);
    expect(Number.isSafeInteger(room.totalPrice)).toBe(true);
  });
});
