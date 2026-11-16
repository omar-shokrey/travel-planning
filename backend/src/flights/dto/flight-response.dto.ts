import { FlightStatus } from '../models/flight.schema';

export class FlightCabinResponseDto {
  cabin: string;
  totalSeats: number;
  bookedSeats: number;
  heldSeats: number;
  availableSeats: number;
  price: number;
  freeBags: number;
  maxBagKg: number;
}

export class FlightResponseDto {
  id: string;
  airlineId: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  departureAt: string;
  arrivalAt: string;
  departureDateLocal: string;
  status: FlightStatus;
  cabins: FlightCabinResponseDto[];
}
