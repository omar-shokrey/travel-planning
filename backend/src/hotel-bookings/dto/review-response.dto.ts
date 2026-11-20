import { ApiProperty } from '@nestjs/swagger';

/** HTL-23: a review as its author sees it. The author's id is never returned. */
export class ReviewResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  id: string;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  hotelId: string;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90456' })
  bookingId: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  rating: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Quiet rooms and a friendly reception.',
  })
  text: string | null;

  @ApiProperty({ example: '2027-06-20T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2027-06-21T08:30:00.000Z' })
  updatedAt: string;
}
