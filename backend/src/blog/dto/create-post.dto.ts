import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { PostStatus } from '../models/post-status.enum';

export class CreatePostDto {
  @ApiProperty({ example: 'Three days in Cairo' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'I spent three amazing days exploring Cairo...' })
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
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
