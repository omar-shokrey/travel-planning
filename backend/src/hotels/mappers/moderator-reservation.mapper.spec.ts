import { Types } from 'mongoose';
import {
  type HotelReservationRecord,
  ModeratorReservationStatus,
} from '../hotel-booking-lookup.service';
import { toModeratorReservationResponse } from './moderator-reservation.mapper';

const ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

const record = (
  fields: Partial<HotelReservationRecord> = {},
): HotelReservationRecord => ({
  _id: ID,
  reference: 'HB-7KQ2MX',
  userId: USER_ID,
  checkIn: '2027-06-15',
  checkOut: '2027-06-18',
  nights: 3,
  status: ModeratorReservationStatus.Confirmed,
  rooms: [{ roomLabel: '101 (Double)', adults: 2, childAges: [7] }],
  createdAt: new Date('2027-06-01T10:00:00.000Z'),
  ...fields,
});

describe('toModeratorReservationResponse (HTL-22)', () => {
  it('shows the guest name, the dates, the rooms, the status and the reference', () => {
    expect(toModeratorReservationResponse(record(), 'Sara Ahmed')).toEqual({
      id: ID.toString(),
      reference: 'HB-7KQ2MX',
      guest: { name: 'Sara Ahmed' },
      checkIn: '2027-06-15',
      checkOut: '2027-06-18',
      nights: 3,
      rooms: [{ roomLabel: '101 (Double)', adults: 2, childAges: [7] }],
      status: ModeratorReservationStatus.Confirmed,
      createdAt: '2027-06-01T10:00:00.000Z',
    });
  });

  it('shows a null name for a deleted account and a null reference, and never the account id', () => {
    const response = toModeratorReservationResponse(
      record({ reference: undefined }),
      undefined,
    );

    expect(response.guest).toEqual({ name: null });
    expect(response.reference).toBeNull();
    expect(JSON.stringify(response)).not.toContain(USER_ID.toString());
  });
});
