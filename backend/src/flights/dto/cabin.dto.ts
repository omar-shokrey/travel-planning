import { IsIn, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

const CABIN_TYPES = [
  'economy',
  'premium_economy',
  'business',
  'first',
] as const;

export class CabinDto {
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
