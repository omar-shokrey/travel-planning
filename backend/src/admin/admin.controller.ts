import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AdminService } from './admin.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** The admin console (`/api/admin/*`). Every route is for administrators only. */
@ApiTags('admin')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@Roles(Role.Admin)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('accounts')
  @ApiOperation({
    summary: 'List all accounts (ACC-14)',
    description:
      'Admin only. Every account (users, moderators and admins), newest first, 10 per page by default (GEN-05), with name, email, role, status and registration date (`createdAt`). `search` matches part of the name or the email in any letter case; `role` and `status` filter. All given filters must match. An empty result is `items: []`.',
  })
  @ApiPaginatedResponse(UserResponseDto)
  @ApiBadRequestResponse({
    description:
      '`page`, `limit`, `search`, `role` or `status` is invalid, or the query has a parameter that is not allowed',
  })
  @ApiForbiddenResponse({
    description: 'The caller is not an administrator, or is suspended',
  })
  listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    return this.adminService.listAccounts(query);
  }

  @Post('moderators')
  @ApiOperation({
    summary: 'Create a hotel or airline moderator account (ACC-13)',
    description:
      'Admin only. Creates an active `airline_moderator` or `hotel_moderator` account linked to exactly one airline or hotel (`providerId`), with the temporary password the admin chose; the admin gives it to the moderator. The account answers with `mustChangePassword: true`: at the first login the moderator must set a new password with PATCH /api/auth/change-password (ACC-08). An airline or hotel may have several moderators.',
  })
  @ApiCreatedResponse({
    description: 'The moderator account was created',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'A field is invalid or missing: the role is not a moderator role, the email is not an email, the temporary password breaks the rule, or `providerId` is not the id of an existing airline (airline moderator) or hotel (hotel moderator). `errors` names each field.',
  })
  @ApiConflictResponse({ description: 'The email is already registered' })
  @ApiForbiddenResponse({
    description: 'The caller is not an administrator, or is suspended',
  })
  createModerator(@Body() dto: CreateModeratorDto): Promise<UserResponseDto> {
    return this.adminService.createModerator(dto);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset a user's or moderator's password (ACC-07a)",
    description:
      'Admin only. Sets the temporary password the admin chose; the admin gives it to the account owner. The account keeps its role and status, any login lockout (ACC-05) is cleared, every session of the account ends at once (its access and refresh cookies get 401), and `mustChangePassword` becomes true: at the next login the owner must set a new password with PATCH /api/auth/change-password (ACC-08). The password of an administrator cannot be reset here.',
  })
  @ApiParam({
    name: 'id',
    description: 'The id of the account',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({
    description: 'The password was reset',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, the temporary password breaks the password rule, or the body has a field that is not allowed',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not an administrator, the caller is suspended, or the account is an administrator',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  resetPassword(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<UserResponseDto> {
    return this.adminService.resetPassword(id, dto);
  }
}
