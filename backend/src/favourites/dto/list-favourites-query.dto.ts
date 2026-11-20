import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';

/** BON-02: the query of GET /api/favourites. */
export class ListFavouritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FavouriteTargetType,
    enumName: 'FavouriteTargetType',
    description: 'Only hotels or only itineraries. Without it: both.',
    example: FavouriteTargetType.Hotel,
  })
  @IsOptional()
  @IsEnum(FavouriteTargetType, {
    message: `targetType must be one of: ${Object.values(FavouriteTargetType).join(', ')}`,
  })
  targetType?: FavouriteTargetType;
}
