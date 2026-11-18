import { Types } from 'mongoose';
import { toManagedRoomResponse } from './managed-room.mapper';

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
  createdAt: new Date('2026-11-05T11:00:00.000Z'),
  updatedAt: new Date('2026-11-06T09:30:00.000Z'),
};

describe('toManagedRoomResponse', () => {
  it('returns the room with its blocked nights joined into ranges', () => {
    const response = toManagedRoomResponse(room, [
      '2026-12-10',
      '2026-12-11',
      '2026-12-20',
    ]);

    expect(response).toEqual({
      id: '6740f1c2a4b5c6d7e8f90124',
      hotelId: '6740f1c2a4b5c6d7e8f90123',
      number: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12500,
      currency: 'USD',
      active: true,
      availability: [{ from: '2026-12-01', to: '2026-12-31' }],
      blocked: [
        { from: '2026-12-10', to: '2026-12-12' },
        { from: '2026-12-20', to: '2026-12-21' },
      ],
      createdAt: '2026-11-05T11:00:00.000Z',
      updatedAt: '2026-11-06T09:30:00.000Z',
    });
  });

  it('shows an empty blocked list for a room without blocks', () => {
    expect(toManagedRoomResponse(room, []).blocked).toEqual([]);
  });
});
