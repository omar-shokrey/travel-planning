import { Types } from 'mongoose';
import { FlightResponsesService } from './flight-responses.service';
import type { FlightSource } from './mappers/flight.mapper';
import { FlightStatus } from './models/flight-status.enum';

const NOW = new Date('2027-01-10T00:00:00.000Z');

const ZONES: Record<string, string> = {
  CAI: 'Africa/Cairo',
  JFK: 'America/New_York',
  NRT: 'Asia/Tokyo',
  DEL: 'Asia/Kolkata',
};

/** A fake Airport model: `find().select().lean().exec()` answers the known codes asked for. */
function setup(known: Record<string, string> = ZONES) {
  const airports = {
    find: jest.fn((filter: { _id: { $in: string[] } }) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue(
          filter._id.$in
            .filter((code) => code in known)
            .map((code) => ({ _id: code, timeZone: known[code] })),
        ),
    })),
  };
  return {
    airports,
    service: new FlightResponsesService(airports as never),
  };
}

const flight = (
  departureAirport: string,
  arrivalAirport: string,
  departureAt: string,
  arrivalAt: string,
): FlightSource => ({
  _id: new Types.ObjectId(),
  airlineId: new Types.ObjectId(),
  flightNumber: 'MS123',
  departureAirport,
  arrivalAirport,
  departureAt: new Date(departureAt),
  arrivalAt: new Date(arrivalAt),
  departureDateLocal: departureAt.slice(0, 10),
  status: FlightStatus.Scheduled,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('FlightResponsesService (GEN-06)', () => {
  describe('toResponses', () => {
    it('reads the zones of every airport of the list in one query, then maps each flight in order', async () => {
      const { service, airports } = setup();
      const flights = [
        // CAI 10:00 -> JFK 15:00, winter.
        flight(
          'CAI',
          'JFK',
          '2027-01-15T08:00:00.000Z',
          '2027-01-15T20:00:00.000Z',
        ),
        // JFK 18:00 -> NRT 22:00 the next day.
        flight(
          'JFK',
          'NRT',
          '2027-01-15T23:00:00.000Z',
          '2027-01-16T13:00:00.000Z',
        ),
        // NRT 09:00 -> DEL 15:30.
        flight(
          'NRT',
          'DEL',
          '2027-01-17T00:00:00.000Z',
          '2027-01-17T10:00:00.000Z',
        ),
      ];

      const responses = await service.toResponses(flights, NOW);

      expect(airports.find).toHaveBeenCalledTimes(1);
      expect(airports.find).toHaveBeenCalledWith({
        _id: { $in: ['CAI', 'JFK', 'NRT', 'DEL'] },
      });
      expect(responses.map((response) => response.id)).toEqual(
        flights.map((stored) => stored._id.toString()),
      );
      expect(
        responses.map((response) => [
          response.departureLocal,
          response.departureTimeZone,
          response.departureUtcOffset,
          response.arrivalLocal,
          response.arrivalTimeZone,
          response.arrivalUtcOffset,
        ]),
      ).toEqual([
        [
          '2027-01-15T10:00',
          'Africa/Cairo',
          '+02:00',
          '2027-01-15T15:00',
          'America/New_York',
          '-05:00',
        ],
        [
          '2027-01-15T18:00',
          'America/New_York',
          '-05:00',
          '2027-01-16T22:00',
          'Asia/Tokyo',
          '+09:00',
        ],
        [
          '2027-01-17T09:00',
          'Asia/Tokyo',
          '+09:00',
          '2027-01-17T15:30',
          'Asia/Kolkata',
          '+05:30',
        ],
      ]);
      // The stored moments stay UTC.
      expect(responses[0].departureAt).toBe('2027-01-15T08:00:00.000Z');
    });

    it('answers an empty list without a query', async () => {
      const { service, airports } = setup();

      await expect(service.toResponses([], NOW)).resolves.toEqual([]);
      expect(airports.find).not.toHaveBeenCalled();
    });

    it('throws an error naming an airport that has no zone, instead of guessing one', async () => {
      const { service } = setup({ CAI: 'Africa/Cairo' });

      await expect(
        service.toResponses(
          [
            flight(
              'CAI',
              'XYZ',
              '2027-01-15T08:00:00.000Z',
              '2027-01-15T20:00:00.000Z',
            ),
          ],
          NOW,
        ),
      ).rejects.toThrow('XYZ');
    });
  });

  describe('toResponse', () => {
    it('maps one flight with one query', async () => {
      const { service, airports } = setup();

      const response = await service.toResponse(
        flight(
          'CAI',
          'JFK',
          '2027-01-15T08:00:00.000Z',
          '2027-01-15T20:00:00.000Z',
        ),
        NOW,
      );

      expect(airports.find).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        departureLocal: '2027-01-15T10:00',
        arrivalLocal: '2027-01-15T15:00',
        status: 'scheduled',
      });
    });
  });

  describe('timeZonesOf', () => {
    it('asks once for each code and returns only the known ones', async () => {
      const { service, airports } = setup();

      const zones = await service.timeZonesOf(['CAI', 'JFK', 'CAI', 'QQQ']);

      expect(airports.find).toHaveBeenCalledWith({
        _id: { $in: ['CAI', 'JFK', 'QQQ'] },
      });
      expect([...zones]).toEqual([
        ['CAI', 'Africa/Cairo'],
        ['JFK', 'America/New_York'],
      ]);
    });
  });
});
