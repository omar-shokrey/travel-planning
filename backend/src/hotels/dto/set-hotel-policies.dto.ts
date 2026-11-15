import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { TIME_OF_DAY_PATTERN } from '../models/hotel-policy.schema';

/**
 * What a hotel moderator may send to set the hotel's policies (HTL-09).
 * `PUT` replaces the policies as a whole, so every field is required.
 */
export class SetHotelPoliciesDto {
  @ApiProperty({
    description:
      'Standard check-in time, local to the hotel, on the 24-hour clock (HH:mm)',
    example: '14:00',
    pattern: TIME_OF_DAY_PATTERN.source,
  })
  @IsString({ message: 'checkInTime must be text' })
  @Matches(TIME_OF_DAY_PATTERN, {
    message: 'checkInTime must be a time such as 14:00 (HH:mm, 24-hour clock)',
  })
  checkInTime: string;

  @ApiProperty({
    description:
      'Standard check-out time, local to the hotel, on the 24-hour clock (HH:mm)',
    example: '12:00',
    pattern: TIME_OF_DAY_PATTERN.source,
  })
  @IsString({ message: 'checkOutTime must be text' })
  @Matches(TIME_OF_DAY_PATTERN, {
    message: 'checkOutTime must be a time such as 12:00 (HH:mm, 24-hour clock)',
  })
  checkOutTime: string;
}
