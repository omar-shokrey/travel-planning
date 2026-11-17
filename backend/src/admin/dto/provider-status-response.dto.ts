import { ApiProperty } from '@nestjs/swagger';
import { ProviderType } from '../../common/enums/provider-type.enum';

/**
 * A hotel or airline after an admin deactivated or reactivated it (ACC-15).
 * One shape for both kinds, so the two routes answer the same way.
 */
export class ProviderStatusResponseDto {
  @ApiProperty({ enum: ProviderType, example: ProviderType.Hotel })
  type: ProviderType;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({
    description:
      'false: hidden from search and cannot be booked; existing confirmed bookings remain valid',
    example: false,
  })
  active: boolean;
}
