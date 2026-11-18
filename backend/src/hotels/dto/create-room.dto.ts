import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import { ROOM_PRICE_MAX } from '../hotels.constants';

const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRoomDto {
  @ApiProperty({
    example: '101',
    description: 'Room number or name, unique within this hotel',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  number: string;

  @ApiProperty({ example: 'Double' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  beds: number;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  maxOccupancy: number;

  @ApiProperty({
    example: 12500,
    minimum: 1,
    maximum: ROOM_PRICE_MAX,
    description: `Price per night in minor units, at most ${ROOM_PRICE_MAX}`,
  })
  @IsInt()
  @Min(1)
  @Max(ROOM_PRICE_MAX, {
    message: `pricePerNight must be at most ${ROOM_PRICE_MAX}`,
  })
  pricePerNight: number;
}
