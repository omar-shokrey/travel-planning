import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  MarkAllReadResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

/**
 * In-app notifications of the logged-in user (GEN-01). Every role has them,
 * and each user only ever sees their own.
 */
@ApiTags('notifications')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({ description: 'Your account is suspended' })
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications (GEN-01)',
    description:
      'GEN-01. The notifications of the logged-in user, newest first, 10 per page by default (GEN-05). `unread=true` lists only the unread ones, `unread=false` only the read ones.',
  })
  @ApiPaginatedResponse(NotificationResponseDto)
  @ApiBadRequestResponse({
    description:
      '`page`, `limit` or `unread` is invalid, or the query has a parameter that is not allowed',
  })
  list(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResponse<NotificationResponseDto>> {
    return this.notificationsService.list(userId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Count my unread notifications (GEN-01)',
    description:
      'GEN-01. The number shown on the notification bell of the logged-in user.',
  })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  unreadCount(
    @CurrentUser('id') userId: string,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.unreadCount(userId);
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all my notifications as read (GEN-01)',
    description:
      'GEN-01. Marks every unread notification of the logged-in user as read and returns how many changed.',
  })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  markAllRead(
    @CurrentUser('id') userId: string,
  ): Promise<MarkAllReadResponseDto> {
    return this.notificationsService.markAllRead(userId);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one notification as read (GEN-01)',
    description:
      'GEN-01. Marks one notification of the logged-in user as read. Marking it again changes nothing and keeps the first read time.',
  })
  @ApiParam({ name: 'id', description: 'The notification id' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiNotFoundResponse({
    description: 'There is no such notification, or it belongs to another user',
  })
  markRead(
    @CurrentUser('id') userId: string,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.markRead(userId, id);
  }
}
