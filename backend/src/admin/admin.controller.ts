import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
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
import { ProviderType } from '../common/enums/provider-type.enum';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AdminService } from './admin.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ProviderStatusResponseDto } from './dto/provider-status-response.dto';
import { PROVIDER_TYPE_MESSAGE } from './admin.constants';

/** `:type` of the provider routes (ACC-15): `hotel` or `airline`, else 400. */
export const PROVIDER_TYPE_PIPE = new ParseEnumPipe(ProviderType, {
  exceptionFactory: () => new BadRequestException(PROVIDER_TYPE_MESSAGE),
});

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

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'Suspend a registered user or a moderator (ACC-15, ACC-16)',
    description:
      'Admin only. Suspends an active `user`, `airline_moderator` or `hotel_moderator` account: it cannot log in or refresh (403 "Your account is suspended"), and every session of the account ends at once. Its bookings stay valid and its content stays visible (hiding content is GEN-10). A moderator also gets an in-app notification; the airline or hotel it manages stays active (deactivating a provider is PATCH /api/admin/providers/:type/:id/deactivate). An administrator cannot be suspended.',
  })
  @ApiParam({
    name: 'id',
    description: 'The id of the account',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({
    description: 'The account is suspended',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The caller is not an administrator or is suspended, or the account is an administrator',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description:
      'The account is already suspended, is deactivated (ACC-12), or was changed by another request',
  })
  suspend(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<UserResponseDto> {
    return this.adminService.suspend(id);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a suspended user or moderator (ACC-15, ACC-16)',
    description:
      'Admin only. Makes a suspended `user`, `airline_moderator` or `hotel_moderator` account active again, so it can log in. Sessions ended by the suspension stay ended: the account logs in again.',
  })
  @ApiParam({
    name: 'id',
    description: 'The id of the account',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @ApiOkResponse({
    description: 'The account is active again',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The caller is not an administrator or is suspended, or the account is an administrator',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description:
      'The account is not suspended, is deactivated (ACC-12), or was changed by another request',
  })
  reactivate(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<UserResponseDto> {
    return this.adminService.reactivate(id);
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

  // ---- Provider status (ACC-15) ----

  @Patch('providers/:type/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate a hotel or airline (ACC-15)',
    description:
      'Admin only. Sets `active: false` on the hotel or airline: it is hidden from search and cannot be booked, while its existing confirmed bookings remain valid. Its moderator accounts are not suspended (that is PATCH /api/admin/accounts/:id/suspend); each of them gets an in-app notification.',
  })
  @ApiParam({ name: 'type', enum: ProviderType, example: ProviderType.Hotel })
  @ApiParam({
    name: 'id',
    description: 'The id of the hotel or airline',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @ApiOkResponse({
    description: 'The provider is deactivated',
    type: ProviderStatusResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The type is not `hotel` or `airline`, or the id is not a valid id',
  })
  @ApiForbiddenResponse({
    description: 'The caller is not an administrator, or is suspended',
  })
  @ApiNotFoundResponse({ description: 'Hotel or airline not found' })
  @ApiConflictResponse({
    description:
      'The provider is already deactivated, or was changed by another request',
  })
  deactivateProvider(
    @Param('type', PROVIDER_TYPE_PIPE) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.adminService.deactivateProvider(type, id);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a hotel or airline (ACC-15)',
    description:
      'Admin only. Sets `active: true` on a deactivated hotel or airline, so it can be found and booked again.',
  })
  @ApiParam({ name: 'type', enum: ProviderType, example: ProviderType.Hotel })
  @ApiParam({
    name: 'id',
    description: 'The id of the hotel or airline',
    example: '6740f1c2a4b5c6d7e8f90abc',
  })
  @ApiOkResponse({
    description: 'The provider is active again',
    type: ProviderStatusResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The type is not `hotel` or `airline`, or the id is not a valid id',
  })
  @ApiForbiddenResponse({
    description: 'The caller is not an administrator, or is suspended',
  })
  @ApiNotFoundResponse({ description: 'Hotel or airline not found' })
  @ApiConflictResponse({
    description:
      'The provider is not deactivated, or was changed by another request',
  })
  reactivateProvider(
    @Param('type', PROVIDER_TYPE_PIPE) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.adminService.reactivateProvider(type, id);
  }
}
