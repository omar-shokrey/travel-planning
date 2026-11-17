import { ApiProperty } from '@nestjs/swagger';

/** The like state of a post for the logged-in user, after a like or unlike (BLG-06). */
export class LikeResponseDto {
  @ApiProperty({ example: '6740a1b2c3d4e5f601234560' })
  postId: string;

  @ApiProperty({
    description: 'Whether the logged-in user likes the post now',
    example: true,
  })
  liked: boolean;

  @ApiProperty({
    description: 'How many users like the post now',
    example: 12,
    minimum: 0,
  })
  likeCount: number;
}
