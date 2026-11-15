import { ApiProperty } from '@nestjs/swagger';
import { PostStatus } from '../models/post-status.enum';

export class PostResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  authorId: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ enum: PostStatus })
  status: PostStatus;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ type: [String] })
  images: string[];
}
