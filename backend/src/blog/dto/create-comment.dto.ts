import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { COMMENT_BODY_MAX } from '../blog.constants';

/**
 * What a user may send to comment on a post (BLG-05). The post comes from the
 * route and the author from the login cookie, never from the body.
 */
export class CreateCommentDto {
  @ApiProperty({
    description: 'The comment text. Spaces around it are removed.',
    example: 'Great tips, I am going to Cairo next month!',
    minLength: 1,
    maxLength: COMMENT_BODY_MAX,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'body must be text' })
  @IsNotEmpty({ message: 'body must not be empty' })
  @MaxLength(COMMENT_BODY_MAX, {
    message: `body must be at most ${COMMENT_BODY_MAX} characters`,
  })
  body: string;
}
