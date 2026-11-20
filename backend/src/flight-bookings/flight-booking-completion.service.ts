import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Model, Types } from 'mongoose';
import { FlightStatus } from '../flights/models/flight-status.enum';
import { Flight } from '../flights/models/flight.schema';
import { FlightBookingStatus } from './enums/flight-booking-status.enum';
import { FLIGHT_BOOKING_COMPLETION_BATCH_SIZE } from './flight-bookings.constants';
import { FlightBooking } from './models/flight-booking.schema';

/**
 * GEN-11: Confirmed -> Completed. A confirmed booking is completed once every
 * flight of it (both of a round trip) has arrived, by a job that runs every
 * hour. A booking with a cancelled flight is left to the cancellation
 * (Confirmed -> Cancelled), never completed. The update matches only a
 * booking still `confirmed`, so a cancellation at the same moment wins.
 */
@Injectable()
export class FlightBookingCompletionService {
  private readonly logger = new Logger(FlightBookingCompletionService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    // Read only: the arrival time and status of each flight.
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

  /** The scheduled run. A job must never crash the app, so every error is logged. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'flight-booking-completion' })
  async completeJob(): Promise<void> {
    try {
      const completed = await this.completeArrived(new Date());
      if (completed > 0) {
        this.logger.log(`Completed ${completed} flight booking(s)`);
      }
    } catch (error) {
      this.logger.error(
        'The flight booking completion job failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  /**
   * Completes the confirmed bookings whose every flight has arrived at or
   * before `now`, none of them cancelled, at most
   * FLIGHT_BOOKING_COMPLETION_BATCH_SIZE per run (the earliest trips first).
   * Returns how many this run completed.
   */
  async completeArrived(now: Date): Promise<number> {
    const due = await this.bookings
      .aggregate<{ _id: Types.ObjectId }>([
        // The (status, holdExpiresAt) index serves the status.
        { $match: { status: FlightBookingStatus.Confirmed } },
        {
          $lookup: {
            from: this.flights.collection.collectionName,
            localField: 'segments.flightId',
            foreignField: '_id',
            pipeline: [{ $project: { arrivalAt: 1, status: 1 } }],
            as: 'flights',
          },
        },
        {
          $match: {
            // Every flight still exists, and none was cancelled.
            $expr: { $eq: [{ $size: '$flights' }, { $size: '$segments' }] },
            'flights.status': { $ne: FlightStatus.Cancelled },
          },
        },
        { $addFields: { lastArrival: { $max: '$flights.arrivalAt' } } },
        { $match: { lastArrival: { $lte: now } } },
        { $sort: { lastArrival: 1, _id: 1 } },
        { $limit: FLIGHT_BOOKING_COMPLETION_BATCH_SIZE },
        { $project: { _id: 1 } },
      ])
      .exec();
    if (due.length === 0) {
      return 0;
    }
    const { modifiedCount } = await this.bookings
      .updateMany(
        {
          _id: { $in: due.map(({ _id }) => _id) },
          status: FlightBookingStatus.Confirmed,
        },
        { $set: { status: FlightBookingStatus.Completed } },
      )
      .exec();
    return modifiedCount;
  }
}
