import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ITN-05: a new day at the end of an itinerary. Its number and date are not
 * sent: they follow from its position and the start date.
 */
export class AddDayDto {
  @ApiProperty({
    description: 'City id from the city list',
    example: 'cairo',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiPropertyOptional({ example: 'Arrive in the evening' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  notes?: string;
}
