import { ApiProperty } from '@nestjs/swagger';

/** An amount of money: whole minor units (cents) plus a currency code. */
export class MoneyResponseDto {
  @ApiProperty({ description: 'Whole minor units (cents)', example: 15000 })
  amount: number;

  @ApiProperty({ description: 'Currency code', example: 'EGP' })
  currency: string;
}
