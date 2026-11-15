import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PostStatus } from '../models/post-status.enum';

export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Cairo' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'I spent three amazing days exploring Cairo...' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    enum: PostStatus,
    default: PostStatus.Draft,
  })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;

  @ApiPropertyOptional({
    type: [String],
    example: ['cairo', 'egypt'],
  })
  @Transform(({ value }) => {
    if (!Array.isArray(value)) {
      return value;
    }

    return [
      ...new Set(
        value
          .map((tag) =>
            typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
          )
          .filter((tag) => tag !== ''),
      ),
    ];
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
