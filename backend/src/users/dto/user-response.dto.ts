import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

/** The airline or hotel a moderator manages (ACC-13). */
export class ModeratorAssignmentResponseDto {
  @ApiProperty({
    enum: ProviderType,
    enumName: 'ProviderType',
    example: ProviderType.Hotel,
  })
  providerType: ProviderType;

  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90abc' })
  providerId: string;
}

/** The public fields of an account. The password hash and the login counters never leave the API. */
export class UserResponseDto {
  @ApiProperty({ example: '6740f1c2a4b5c6d7e8f90123' })
  id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ enum: Role, enumName: 'Role', example: Role.User })
  role: Role;

  @ApiProperty({
    enum: UserStatus,
    enumName: 'UserStatus',
    example: UserStatus.Active,
  })
  status: UserStatus;

  @ApiProperty({
    description:
      'True while the account has a temporary password set by an admin (ACC-07a, ACC-13). The frontend then sends the user to change it (PATCH /api/auth/change-password, ACC-08), which sets it back to false.',
    example: false,
  })
  mustChangePassword: boolean;

  @ApiPropertyOptional({
    description: 'The phone number (ACC-09). Left out when there is none.',
    example: '+20 10 1234 5678',
  })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'The currency the user wants prices shown in (ACC-09). Left out when there is none: prices are then shown in USD, the platform currency.',
    example: 'EGP',
  })
  preferredCurrency?: string;

  @ApiPropertyOptional({
    type: ModeratorAssignmentResponseDto,
    description:
      'Only for a moderator: the one airline or hotel it manages (ACC-13). Left out for other accounts.',
  })
  assignment?: ModeratorAssignmentResponseDto;

  @ApiProperty({
    description: 'When the account was created, in UTC',
    example: '2026-11-05T11:00:00.000Z',
  })
  createdAt: string;
}
