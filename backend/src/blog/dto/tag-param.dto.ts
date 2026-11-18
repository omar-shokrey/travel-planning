import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { POST_TAG_MAX_LENGTH } from '../blog.constants';

/** The tag in `GET /api/tags/:tag/posts` (BLG-08), read like a stored tag. */
export class TagParamDto {
  @ApiProperty({
    example: 'cairo',
    maxLength: POST_TAG_MAX_LENGTH,
    description:
      'The tag. Outer spaces and letter case are ignored, as when a tag is saved.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_TAG_MAX_LENGTH)
  tag: string;
}
