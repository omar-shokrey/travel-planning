import { ApiProperty } from '@nestjs/swagger';

/** A review as the API returns it (HTL-23, HTL-24). */
export class ReviewResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90999' })
  id: string;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  hotelId: string;

  @ApiProperty({
    description: 'The reservation that was reviewed',
    example: '6740f1c2a4b5c6d7e8f90789',
  })
  bookingId: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  rating: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The review text, or `null` when there is none',
    example: 'Quiet rooms and a great breakfast.',
  })
  text: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The name of the guest who wrote it. `null` only if the account no longer exists.',
    example: 'Sara Ahmed',
  })
  authorName: string | null;

  @ApiProperty({ example: '2026-12-15T09:30:00.000Z' })
  createdAt: string;

  @ApiProperty({
    description: 'Differs from `createdAt` once the review was edited',
    example: '2026-12-15T09:30:00.000Z',
  })
  updatedAt: string;
}
