import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

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
    description: 'Price per night in minor units',
  })
  @IsInt()
  @Min(1)
  pricePerNight: number;
}
