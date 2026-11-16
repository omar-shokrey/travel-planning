import { Types } from 'mongoose';
import { toRoomResponse, type RoomSource } from './room.mapper';

const source: RoomSource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  hotelId: new Types.ObjectId('6740f1c2a4b5c6d7e8f90124'),
  number: '101',
  type: 'Double',
  beds: 2,
  maxOccupancy: 3,
  pricePerNight: 12500,
  active: true,
  createdAt: new Date('2026-11-05T13:00:00.000+02:00'),
  updatedAt: new Date('2026-11-06T13:00:00.000+02:00'),
};

describe('toRoomResponse (HTL-03)', () => {
  it('maps public fields, string ids and UTC timestamps', () => {
    expect(toRoomResponse(source)).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      hotelId: '6740f1c2a4b5c6d7e8f90124',
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      currency: 'USD',
      active: true,
      createdAt: '2026-11-05T11:00:00.000Z',
      updatedAt: '2026-11-06T11:00:00.000Z',
    });
  });

  it('does not expose unlisted internal fields', () => {
    const response = toRoomResponse({
      ...source,
      internalHold: 'private',
    } as RoomSource & { internalHold: string });

    expect(Object.keys(response).sort()).toEqual([
      'active',
      'beds',
      'createdAt',
      'currency',
      'hotelId',
      'id',
      'maxOccupancy',
      'number',
      'pricePerNight',
      'type',
      'updatedAt',
    ]);
  });
});
