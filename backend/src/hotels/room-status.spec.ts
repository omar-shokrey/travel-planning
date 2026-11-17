import { RoomNightState } from './models/room-night-state.enum';
import { RoomStatus, roomStatusSegments } from './room-status';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const LATER = new Date('2026-11-17T12:10:00.000Z');
const EARLIER = new Date('2026-11-17T11:50:00.000Z');
const BOOKING = '6740f1c2a4b5c6d7e8f90130';
const OTHER_BOOKING = '6740f1c2a4b5c6d7e8f90131';

const range = (from: string, to: string) => ({ from, to });

describe('roomStatusSegments (HTL-08)', () => {
  it('shows a free bookable range as one available segment', () => {
    expect(
      roomStatusSegments(
        range('2026-12-01', '2026-12-05'),
        [range('2026-11-01', '2027-01-01')],
        [],
        NOW,
      ),
    ).toEqual([
      { from: '2026-12-01', to: '2026-12-05', status: RoomStatus.Available },
    ]);
  });

  it('marks nights outside every availability range as unavailable', () => {
    expect(
      roomStatusSegments(
        range('2026-12-01', '2026-12-06'),
        [range('2026-12-03', '2026-12-05')],
        [],
        NOW,
      ),
    ).toEqual([
      { from: '2026-12-01', to: '2026-12-03', status: RoomStatus.Unavailable },
      { from: '2026-12-03', to: '2026-12-05', status: RoomStatus.Available },
      { from: '2026-12-05', to: '2026-12-06', status: RoomStatus.Unavailable },
    ]);
  });

  it('shows blocked and booked nights, with the reservation of each', () => {
    expect(
      roomStatusSegments(
        range('2026-12-01', '2026-12-07'),
        [range('2026-12-01', '2026-12-31')],
        [
          { date: '2026-12-02', state: RoomNightState.Blocked },
          { date: '2026-12-03', state: RoomNightState.Blocked },
          {
            date: '2026-12-04',
            state: RoomNightState.Booked,
            bookingId: BOOKING,
          },
          {
            date: '2026-12-05',
            state: RoomNightState.Booked,
            bookingId: OTHER_BOOKING,
          },
        ],
        NOW,
      ),
    ).toEqual([
      { from: '2026-12-01', to: '2026-12-02', status: RoomStatus.Available },
      { from: '2026-12-02', to: '2026-12-04', status: RoomStatus.Blocked },
      {
        from: '2026-12-04',
        to: '2026-12-05',
        status: RoomStatus.Booked,
        bookingId: BOOKING,
        pendingPayment: false,
      },
      {
        from: '2026-12-05',
        to: '2026-12-06',
        status: RoomStatus.Booked,
        bookingId: OTHER_BOOKING,
        pendingPayment: false,
      },
      { from: '2026-12-06', to: '2026-12-07', status: RoomStatus.Available },
    ]);
  });

  it('counts a hold that has not expired as booked and pending payment', () => {
    expect(
      roomStatusSegments(
        range('2026-12-01', '2026-12-03'),
        [range('2026-12-01', '2026-12-31')],
        [
          {
            date: '2026-12-01',
            state: RoomNightState.Held,
            bookingId: BOOKING,
            holdExpiresAt: LATER,
          },
          {
            date: '2026-12-02',
            state: RoomNightState.Held,
            bookingId: BOOKING,
            holdExpiresAt: LATER,
          },
        ],
        NOW,
      ),
    ).toEqual([
      {
        from: '2026-12-01',
        to: '2026-12-03',
        status: RoomStatus.Booked,
        bookingId: BOOKING,
        pendingPayment: true,
      },
    ]);
  });

  it('ignores a hold whose time has passed', () => {
    expect(
      roomStatusSegments(
        range('2026-12-01', '2026-12-02'),
        [range('2026-12-01', '2026-12-31')],
        [
          {
            date: '2026-12-01',
            state: RoomNightState.Held,
            bookingId: BOOKING,
            holdExpiresAt: EARLIER,
          },
        ],
        NOW,
      ),
    ).toEqual([
      { from: '2026-12-01', to: '2026-12-02', status: RoomStatus.Available },
    ]);
  });

  it('ends the last segment on the end of the range, across a month', () => {
    const segments = roomStatusSegments(
      range('2026-12-30', '2027-01-02'),
      [],
      [],
      NOW,
    );
    expect(segments).toEqual([
      { from: '2026-12-30', to: '2027-01-02', status: RoomStatus.Unavailable },
    ]);
  });
});
