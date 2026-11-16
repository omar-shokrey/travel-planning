import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const CABIN_TYPES = [
  'economy',
  'premium_economy',
  'business',
  'first',
] as const;

export class CreateFlightCabinDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(CABIN_TYPES)
  cabin: string;

  @IsInt()
  @Min(1)
  totalSeats: number;

  @IsInt()
  @Min(0)
  bookedSeats: number;

  @IsInt()
  @Min(0)
  heldSeats: number;

  @IsInt()
  @Min(0)
  price: number;

  @IsInt()
  @Min(0)
  freeBags: number;

  @IsInt()
  @Min(0)
  maxBagKg: number;
}

export class CreateFlightDto {
  @IsString()
  @IsNotEmpty()
  flightNumber: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, {
    message: 'departureAirport must be a 3-letter IATA airport code',
  })
  departureAirport: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, {
    message: 'arrivalAirport must be a 3-letter IATA airport code',
  })
  arrivalAirport: string;

  @IsDateString()
  departureAt: string;

  @IsDateString()
  arrivalAt: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'departureDateLocal must use YYYY-MM-DD format',
  })
  departureDateLocal: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFlightCabinDto)
  @Min(1)
  @Max(4)
  cabins: CreateFlightCabinDto[];
}
