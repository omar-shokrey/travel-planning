import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';

/** BON-02: what to save. The owner is the logged-in user, never the body. */
export class AddFavouriteDto {
  @ApiProperty({
    enum: FavouriteTargetType,
    enumName: 'FavouriteTargetType',
    example: FavouriteTargetType.Hotel,
  })
  @IsEnum(FavouriteTargetType, {
    message: `targetType must be one of: ${Object.values(FavouriteTargetType).join(', ')}`,
  })
  targetType: FavouriteTargetType;

  @ApiProperty({
    description: 'The id of the hotel or of the public itinerary',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @IsMongoId({ message: 'targetId must be a valid id' })
  targetId: string;
}
