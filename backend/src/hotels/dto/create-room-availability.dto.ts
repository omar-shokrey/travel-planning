import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ROOM_DATE_ONLY_PATTERN } from '../hotels.constants';

@ValidatorConstraint({ name: 'roomAvailabilityDateOrder', async: false })
class RoomAvailabilityDateOrderConstraint implements ValidatorConstraintInterface {
  validate(from: unknown, args: ValidationArguments): boolean {
    const to = (args.object as { to?: unknown }).to;
    return typeof from === 'string' && typeof to === 'string' && from < to;
  }

  defaultMessage(): string {
    return 'from must be earlier than to';
  }
}

export class CreateRoomAvailabilityDto {
  @ApiProperty({
    description: 'First bookable night, inclusive, in YYYY-MM-DD format',
    example: '2026-12-01',
  })
  @Matches(ROOM_DATE_ONLY_PATTERN, {
    message: 'from must be a date in the form YYYY-MM-DD',
  })
  @IsISO8601({ strict: true }, { message: 'from must be a real calendar date' })
  @Validate(RoomAvailabilityDateOrderConstraint)
  from: string;

  @ApiProperty({
    description: 'Checkout boundary, exclusive, in YYYY-MM-DD format',
    example: '2026-12-08',
  })
  @Matches(ROOM_DATE_ONLY_PATTERN, {
    message: 'to must be a date in the form YYYY-MM-DD',
  })
  @IsISO8601({ strict: true }, { message: 'to must be a real calendar date' })
  to: string;
}
