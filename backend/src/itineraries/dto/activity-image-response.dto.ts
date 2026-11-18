import { ApiProperty } from '@nestjs/swagger';

/** ITN-12: an image of an activity, the same shape as a hotel photo. */
export class ActivityImageResponseDto {
  @ApiProperty({
    description:
      'The stored file name. It is the `imageId` of `DELETE /api/activities/:id/images/:imageId`.',
    example: 'c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  filename: string;

  @ApiProperty({
    description: 'Where the image is served',
    example: '/api/uploads/c0d0a8a0-95ab-4bfc-b635-4f98b95a6b0c.jpg',
  })
  url: string;
}
