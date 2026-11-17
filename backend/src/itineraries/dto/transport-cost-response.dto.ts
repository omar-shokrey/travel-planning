import { ApiProperty } from '@nestjs/swagger';

/** ITN-16: a transport cost of a day, as the API returns it. */
export class TransportCostResponseDto {
  @ApiProperty({ example: '6741c0ffee0ddba11ad0b0b0' })
  id: string;

  @ApiProperty({ example: 'train' })
  mode: string;

  @ApiProperty({ example: 'cairo' })
  fromCityId: string;

  @ApiProperty({ example: 'luxor' })
  toCityId: string;

  @ApiProperty({ description: 'Whole minor units (cents)', example: 90000 })
  amount: number;

  @ApiProperty({ example: 'EGP' })
  currency: string;
}
