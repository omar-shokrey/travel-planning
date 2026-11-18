import { ApiProperty } from '@nestjs/swagger';

export class PostSummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  publishedAt: string;
}
