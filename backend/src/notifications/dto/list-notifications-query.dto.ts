import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * A query string carries text, so "true" and "false" become booleans here.
 * Anything else is left as it is, for @IsBoolean() to reject.
 */
const toBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

/** `GET /api/notifications?page=1&limit=10&unread=true` (GEN-01, GEN-05). */
export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'true lists only unread notifications. Leave it out for all.',
    type: Boolean,
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;
}
