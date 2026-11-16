import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { User, UserDocument } from '../users/models/user.schema';
import { Flight, FlightDocument, FlightStatus } from './models/flight.schema';
import { CreateFlightDto } from './dto/create-flight.dto';
import {
  FlightCabinResponseDto,
  FlightResponseDto,
} from './dto/flight-response.dto';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name)
    private readonly flightModel: Model<FlightDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async create(
    userId: string,
    dto: CreateFlightDto,
  ): Promise<FlightResponseDto> {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.AirlineModerator) {
      throw new ForbiddenException(
        'Only airline moderators can create flights',
      );
    }

    if (
      !user.assignment ||
      user.assignment.providerType !== ProviderType.Airline
    ) {
      throw new ForbiddenException('You are not assigned to an airline');
    }

    const airlineId = user.assignment.providerId;

    const departureAirport = dto.departureAirport.toUpperCase();
    const arrivalAirport = dto.arrivalAirport.toUpperCase();

    if (departureAirport === arrivalAirport) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const departureAt = new Date(dto.departureAt);
    const arrivalAt = new Date(dto.arrivalAt);

    if (arrivalAt <= departureAt) {
      throw new BadRequestException(
        'Arrival time must be after departure time',
      );
    }

    const cabins = dto.cabins.map((cabin) => {
      if (cabin.bookedSeats + cabin.heldSeats > cabin.totalSeats) {
        throw new BadRequestException(
          `Booked and held seats cannot exceed total seats for ${cabin.cabin}`,
        );
      }

      return {
        cabin: cabin.cabin,
        totalSeats: cabin.totalSeats,
        bookedSeats: cabin.bookedSeats,
        heldSeats: cabin.heldSeats,
        price: cabin.price,
        freeBags: cabin.freeBags,
        maxBagKg: cabin.maxBagKg,
      };
    });

    const existingFlight = await this.flightModel
      .exists({
        airlineId: new Types.ObjectId(airlineId),
        flightNumber: dto.flightNumber,
        departureDateLocal: dto.departureDateLocal,
      })
      .exec();

    if (existingFlight) {
      throw new BadRequestException(
        'This airline already has a flight with the same flight number on this departure date',
      );
    }

    const flight = await this.flightModel.create({
      airlineId,
      flightNumber: dto.flightNumber,
      departureAirport,
      arrivalAirport,
      departureAt,
      arrivalAt,
      departureDateLocal: dto.departureDateLocal,
      status: FlightStatus.Scheduled,
      cabins,
    });

    return this.toResponseDto(flight);
  }

  private toResponseDto(flight: FlightDocument): FlightResponseDto {
    const cabins: FlightCabinResponseDto[] = flight.cabins.map((cabin) => ({
      cabin: cabin.cabin,
      totalSeats: cabin.totalSeats,
      bookedSeats: cabin.bookedSeats,
      heldSeats: cabin.heldSeats,
      availableSeats: cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
      price: cabin.price,
      freeBags: cabin.freeBags,
      maxBagKg: cabin.maxBagKg,
    }));

    return {
      id: flight._id.toString(),
      airlineId: flight.airlineId.toString(),
      flightNumber: flight.flightNumber,
      departureAirport: flight.departureAirport,
      arrivalAirport: flight.arrivalAirport,
      departureAt: flight.departureAt.toISOString(),
      arrivalAt: flight.arrivalAt.toISOString(),
      departureDateLocal: flight.departureDateLocal,
      status: flight.status,
      cabins,
    };
  }
}
