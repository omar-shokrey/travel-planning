import { Types } from 'mongoose';
import { toAvailableRoomResponse } from './available-room.mapper';

describe('toAvailableRoomResponse (HTL-15)', () => {
  it('returns the public fields of the room and the price of the stay', () => {
    const room = {
      _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90124'),
      hotelId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      active: true,
      availability: [{ from: '2026-12-01', to: '2026-12-31' }],
    };

    expect(toAvailableRoomResponse(room, 3)).toEqual({
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
});
