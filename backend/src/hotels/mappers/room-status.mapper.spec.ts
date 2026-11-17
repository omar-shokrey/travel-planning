import { Types } from 'mongoose';
import { RoomStatus } from '../room-status';
import { toRoomStatusResponse } from './room-status.mapper';

const room = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90124'),
  number: '101',
  type: 'Double',
  active: false,
};

describe('toRoomStatusResponse (HTL-08)', () => {
  it('returns the room id as a string with its segments', () => {
    expect(
      toRoomStatusResponse(room, [
        { from: '2026-12-01', to: '2026-12-03', status: RoomStatus.Available },
        {
          from: '2026-12-03',
          to: '2026-12-05',
          status: RoomStatus.Booked,
          bookingId: '6740f1c2a4b5c6d7e8f90130',
          pendingPayment: true,
        },
      ]),
    ).toEqual({
      id: '6740f1c2a4b5c6d7e8f90124',
      number: '101',
      type: 'Double',
      active: false,
      segments: [
        { from: '2026-12-01', to: '2026-12-03', status: 'available' },
        {
          from: '2026-12-03',
          to: '2026-12-05',
          status: 'booked',
          bookingId: '6740f1c2a4b5c6d7e8f90130',
          pendingPayment: true,
        },
      ],
    });
  });

  it('leaves out the booking fields of a segment that has none', () => {
    const [segment] = toRoomStatusResponse(room, [
      { from: '2026-12-01', to: '2026-12-02', status: RoomStatus.Blocked },
    ]).segments;

    expect(Object.keys(segment)).toEqual(['from', 'to', 'status']);
  });
});
