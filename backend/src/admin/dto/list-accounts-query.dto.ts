import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { ACCOUNT_SEARCH_MAX_LENGTH } from '../admin.constants';

/** Trims the search. A blank search means no search. Anything that is not a text is left for @IsString() to reject. */
const trimToUndefined = ({ value }: TransformFnParams): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * `GET /api/admin/accounts?page=1&limit=10&search=sara&role=user&status=active`
 * (ACC-14, GEN-05). Every filter is optional; together they must all match.
 */
export class ListAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Part of the name or the email, in any letter case. Outer spaces are ignored.',
    example: 'sara',
    maxLength: ACCOUNT_SEARCH_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(ACCOUNT_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({
    description: 'Only accounts with this role',
    enum: Role,
    enumName: 'Role',
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description: 'Only accounts with this status',
    enum: UserStatus,
    enumName: 'UserStatus',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
