import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AuthorPageQueryDto {
  @ApiPropertyOptional({
    description: 'Posts page number, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  postsPage: number = 1;

  @ApiPropertyOptional({
    description: 'Number of posts per page',
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  postsLimit: number = 10;

  @ApiPropertyOptional({
    description: 'Itineraries page number, starting at 1',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itinerariesPage: number = 1;

  @ApiPropertyOptional({
    description: 'Number of itineraries per page',
    minimum: 1,
    maximum: 50,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  itinerariesLimit: number = 10;
}
