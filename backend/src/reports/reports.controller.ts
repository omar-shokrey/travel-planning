import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportResponseDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Roles(Role.User)
  @ApiOperation({
    summary: 'Report a post, a comment or an itinerary (GEN-09)',
    description:
      'Registered users only. Send `targetType` (`post`, `comment` or `itinerary`), the `targetId` and a `reason` (1 to 500 characters after trimming); all three are required. A post must be published, a comment must be one you can see (not hidden, on a published post that is not hidden) and an itinerary must be one you can see (public, or your own). You cannot report your own content, and you can report each item only once. The reporter, the status (`open`) and the dates are set by the server; an admin handles the report later (GEN-10).',
  })
  @ApiCreatedResponse({
    description: 'The report was saved with status `open`',
    type: ReportResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'A field is missing, `null` or invalid (an unknown `targetType`, a `targetId` that is not an id, an empty reason or one over 500 characters), a field the server sets was sent, or the content is your own. `errors` lists each invalid field.',
  })
  @ApiUnauthorizedResponse({
    description: 'Not logged in, or the access token is invalid or expired',
  })
  @ApiForbiddenResponse({
    description:
      'The caller is not a registered user (admins and moderators do not report content), or the account is suspended',
  })
  @ApiNotFoundResponse({
    description:
      'No such post, comment or itinerary, or one you cannot see (a draft or hidden post, a hidden comment or one on a draft or hidden post, or an itinerary that is private, hidden or of a deactivated author)',
  })
  @ApiConflictResponse({
    description: 'You have already reported this item',
  })
  create(
    @Body() dto: CreateReportDto,
    @CurrentUser('id') userId: string,
  ): Promise<ReportResponseDto> {
    return this.reports.create(dto, userId);
  }
}
