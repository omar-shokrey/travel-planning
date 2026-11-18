import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { PaginatedResponse } from '../common/dto/paginated-response.dto';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AdminReportResponseDto } from '../reports/dto/admin-report-response.dto';
import { ReportTargetType } from '../reports/enums/report-target-type.enum';
import { CONTENT_TYPE_MESSAGE } from './admin-moderation.constants';
import { AdminModerationService } from './admin-moderation.service';
import { AdminContentResponseDto } from './dto/admin-content-response.dto';
import { ContentModerationResponseDto } from './dto/content-moderation-response.dto';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ModerateContentDto } from './dto/moderate-content.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

/**
 * `:type` of the content routes (GEN-10): `post`, `itinerary` or `comment`,
 * else 400.
 */
export const CONTENT_TYPE_PIPE = new ParseEnumPipe(ReportTargetType, {
  exceptionFactory: () => new BadRequestException(CONTENT_TYPE_MESSAGE),
});

/** Swagger: the `:type` and `:id` of the content routes. */
const ApiContentParams = () =>
  applyDecorators(
    ApiParam({
      name: 'type',
      enum: ReportTargetType,
      description: 'The kind of content',
    }),
    ApiParam({
      name: 'id',
      description: 'The id of the post, comment or itinerary',
      example: '6745a1b2c3d4e5f6a7b8c9d0',
    }),
  );

/**
 * GEN-10: report handling and content moderation in the admin console
 * (`/api/admin/*`). Administrators only. A controller of its own, next to
 * `AdminController`, so this feature and the account features change
 * different files.
 */
@ApiTags('admin')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Not logged in, or the access token is invalid or expired',
})
@ApiForbiddenResponse({
  description: 'The caller is not an administrator, or is suspended',
})
@Roles(Role.Admin)
@Controller('admin')
export class AdminModerationController {
  constructor(private readonly moderation: AdminModerationService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List reported content (GEN-09, GEN-10)',
    description:
      'Admin only. The open reports by default (`status=open`), oldest first so the reports that waited longest come first, 10 per page (GEN-05). `status` shows resolved reports instead (`dismissed`, `hidden`, `deleted`) and `targetType` keeps one kind of content. Each item has the content (`targetType`, `targetId`), the reason, the reporter and, once resolved, `resolvedBy` and `resolvedAt`. An empty result is `items: []`.',
  })
  @ApiPaginatedResponse(AdminReportResponseDto)
  @ApiBadRequestResponse({
    description:
      '`page`, `limit`, `status` or `targetType` is invalid, or the query has a parameter that is not allowed',
  })
  listReports(
    @Query() query: ListReportsQueryDto,
  ): Promise<PaginatedResponse<AdminReportResponseDto>> {
    return this.moderation.listReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'Resolve a report (GEN-10)',
    description:
      'Admin only. Resolves an open report with `action`: `dismiss` (the content stays as it is), `hide` (only its author and admins still see it) or `delete` (the content and its images are deleted). The report gets the status `dismissed`, `hidden` or `deleted`, with the admin as `resolvedBy` and the time as `resolvedAt`. `hide` and `delete` also resolve the other open reports of the same content the same way. Deleting content that its author already deleted just closes the report.',
  })
  @ApiParam({
    name: 'id',
    description: 'The id of the report',
    example: '6745a1b2c3d4e5f6a7b8c9d1',
  })
  @ApiOkResponse({
    description: 'The report was resolved',
    type: AdminReportResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, `action` is missing, `null` or unknown, or the body has a field that is not allowed',
  })
  @ApiNotFoundResponse({ description: 'Report not found' })
  @ApiConflictResponse({
    description:
      'The report is already resolved (also when another admin resolved it a moment earlier), or `hide` was asked for content that no longer exists',
  })
  resolveReport(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
    @CurrentUser('id') adminId: string,
  ): Promise<AdminReportResponseDto> {
    return this.moderation.resolveReport(id, dto.action, adminId);
  }

  @Get('content/:type/:id')
  @ApiOperation({
    summary: 'View a post, a comment or an itinerary (GEN-10)',
    description:
      'Admin only. Any post (a draft too), comment or itinerary, whoever wrote it and hidden or not: hidden content is visible only to its author and admins. Use it to read reported content (`targetType` and `targetId` of a report) before resolving the report. `moderation` says whether it is hidden; exactly one of `post`, `comment` and `itinerary` is set.',
  })
  @ApiContentParams()
  @ApiOkResponse({ type: AdminContentResponseDto })
  @ApiBadRequestResponse({
    description:
      '`type` is not `post`, `itinerary` or `comment`, or the id is not a valid id',
  })
  @ApiNotFoundResponse({
    description: 'Post not found, comment not found, or itinerary not found',
  })
  viewContent(
    @Param('type', CONTENT_TYPE_PIPE) type: ReportTargetType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<AdminContentResponseDto> {
    return this.moderation.viewContent(type, id);
  }

  @Patch('content/:type/:id')
  @ApiOperation({
    summary: 'Hide or show a post, a comment or an itinerary (GEN-10)',
    description:
      'Admin only. `moderation: hidden` hides the content from everyone but its author and admins, and resolves its open reports as `hidden`. `moderation: visible` shows it again (to undo a mistaken hide); resolved reports stay resolved. A hidden comment is left out of the comment list of its post for everyone and out of the `commentCount` of the post; its author can still edit or delete it. Section 8 of the project description has no route for this, so it follows the `DELETE` route below.',
  })
  @ApiContentParams()
  @ApiOkResponse({
    description: 'The moderation state was changed',
    type: ContentModerationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      '`type` is not `post`, `itinerary` or `comment`, the id is not a valid id, `moderation` is missing, `null` or unknown, or the body has a field that is not allowed',
  })
  @ApiNotFoundResponse({
    description: 'Post not found, comment not found, or itinerary not found',
  })
  @ApiConflictResponse({
    description: 'The content already has this moderation state',
  })
  moderateContent(
    @Param('type', CONTENT_TYPE_PIPE) type: ReportTargetType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ModerateContentDto,
    @CurrentUser('id') adminId: string,
  ): Promise<ContentModerationResponseDto> {
    return this.moderation.moderateContent(type, id, dto.moderation, adminId);
  }

  @Delete('content/:type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a post, a comment or an itinerary (GEN-10)',
    description:
      'Admin only. Deletes any post, comment or itinerary and its image files, whoever wrote it. Deleting a visible comment lowers the `commentCount` of the post by one. Its open reports are resolved as `deleted`; reports are kept as history. Clones of a deleted itinerary are not affected.',
  })
  @ApiContentParams()
  @ApiNoContentResponse({ description: 'The content was deleted' })
  @ApiBadRequestResponse({
    description:
      '`type` is not `post`, `itinerary` or `comment`, or the id is not a valid id',
  })
  @ApiNotFoundResponse({
    description: 'Post not found, comment not found, or itinerary not found',
  })
  deleteContent(
    @Param('type', CONTENT_TYPE_PIPE) type: ReportTargetType,
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<void> {
    return this.moderation.deleteContent(type, id, adminId);
  }
}
