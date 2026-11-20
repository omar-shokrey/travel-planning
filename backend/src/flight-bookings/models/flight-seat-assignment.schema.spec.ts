import { model, Types } from 'mongoose';
import { CabinClass } from '../../flights/models/cabin-class.enum';
import { FlightSeatAssignmentSchema } from './flight-seat-assignment.schema';

// Validation runs in memory: no database is opened.
const AssignmentModel = model(
  'FlightSeatAssignmentSchemaSpec',
  FlightSeatAssignmentSchema,
);

const assignment = (fields: Record<string, unknown> = {}) =>
  new AssignmentModel({
    flightId: new Types.ObjectId(),
    cabin: CabinClass.Economy,
    seatNumber: '12C',
    bookingId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    segmentIndex: 0,
    passengerIndex: 0,
    ...fields,
  });

const invalidPaths = (doc: ReturnType<typeof assignment>): string[] =>
  Object.keys(doc.validateSync()?.errors ?? {});

describe('FlightSeatAssignment schema (FLT-28)', () => {
  it('is stored in the flight_seat_assignments collection', () => {
    expect(AssignmentModel.collection.collectionName).toBe(
      'flight_seat_assignments',
    );
  });

  it('accepts a seat of one passenger on one segment', () => {
    expect(assignment().validateSync()).toBeUndefined();
  });

  it.each([
    ['cabin', { cabin: 'cargo' }],
    ['seatNumber', { seatNumber: '12' }],
    ['seatNumber', { seatNumber: '0A' }],
    ['seatNumber', { seatNumber: '12c' }],
    ['segmentIndex', { segmentIndex: 2 }],
    ['segmentIndex', { segmentIndex: 0.5 }],
    ['passengerIndex', { passengerIndex: -1 }],
    ['passengerIndex', { passengerIndex: 18 }],
    ['passengerIndex', { passengerIndex: 1.5 }],
  ])('refuses a bad %s', (path, fields) => {
    expect(invalidPaths(assignment(fields))).toContain(path);
  });

  it.each([
    'flightId',
    'cabin',
    'seatNumber',
    'bookingId',
    'userId',
    'segmentIndex',
    'passengerIndex',
  ])('requires %s', (path) => {
    expect(invalidPaths(assignment({ [path]: undefined }))).toContain(path);
  });

  it('has one passenger per seat and one seat per passenger and segment, and no other index', () => {
    expect(FlightSeatAssignmentSchema.indexes()).toEqual([
      [{ flightId: 1, cabin: 1, seatNumber: 1 }, { unique: true }],
      [{ bookingId: 1, segmentIndex: 1, passengerIndex: 1 }, { unique: true }],
    ]);
  });
});
