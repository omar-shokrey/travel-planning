import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { AuditTargetType } from '../audit/enums/audit-target-type.enum';
import { PostsService } from '../blog/posts.service';
import {
  paginate,
  type PaginatedResponse,
} from '../common/dto/paginated-response.dto';
import { ItinerariesService } from '../itineraries/itineraries.service';
import type { AdminReportResponseDto } from '../reports/dto/admin-report-response.dto';
import {
  REPORT_ACTION_STATUS,
  ReportAction,
} from '../reports/enums/report-action.enum';
import { ReportStatus } from '../reports/enums/report-status.enum';
import { ReportTargetType } from '../reports/enums/report-target-type.enum';
import { toAdminReportResponse } from '../reports/mappers/report.mapper';
import { ReportsService } from '../reports/reports.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  alreadyModeratedMessage,
  CONTENT_NOT_FOUND_MESSAGE,
  REPORT_ALREADY_RESOLVED_MESSAGE,
  reportedContentGoneMessage,
} from './admin-moderation.constants';
import type { ContentModerationResponseDto } from './dto/content-moderation-response.dto';
import type { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ContentModeration } from './enums/content-moderation.enum';

/** The audit target type (GEN-07) of each kind of reported content. */
const CONTENT_AUDIT_TARGET: Record<ReportTargetType, AuditTargetType> = {
  [ReportTargetType.Post]: AuditTargetType.Post,
  [ReportTargetType.Itinerary]: AuditTargetType.Itinerary,
};

/**
 * GEN-10: the admin's report queue and content moderation. The reports belong
 * to `ReportsService`, the posts to `PostsService` and the itineraries to
 * `ItinerariesService`; this service only decides what happens, in which
 * order, and maps the answers.
 */
@Injectable()
export class AdminModerationService {
  private readonly logger = new Logger(AdminModerationService.name);

  constructor(
    private readonly reports: ReportsService,
    private readonly posts: PostsService,
    private readonly itineraries: ItinerariesService,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  /** GEN-10: one page of reports, open ones by default, oldest first. */
  async listReports(
    query: ListReportsQueryDto,
  ): Promise<PaginatedResponse<AdminReportResponseDto>> {
    const { items, total } = await this.reports.listForAdmin(
      { status: query.status, targetType: query.targetType },
      { skip: query.skip, limit: query.limit },
    );
    return paginate(items.map(toAdminReportResponse), total, query);
  }

  /**
   * GEN-10: resolves an open report by dismissing it, hiding its content or
   * deleting its content.
   *
   * The report is claimed first, with a conditional update that only an open
   * report passes, and the content changes only after that. So of two admins
   * at the same moment only one acts, and the other gets 409 without touching
   * the content. Hiding or deleting then resolves the other open reports of
   * the same content with the same status, because the content they point at
   * has changed; dismissing affects this report only.
   */
  async resolveReport(
    id: string,
    action: ReportAction,
    adminId: string,
  ): Promise<AdminReportResponseDto> {
    const report = await this.reports.findEntityOrThrow(id);
    if (report.status !== ReportStatus.Open) {
      throw new ConflictException(REPORT_ALREADY_RESOLVED_MESSAGE);
    }
    const { targetType } = report;
    const targetId = report.targetId.toString();

    // Content that its author deleted since cannot be hidden. The report
    // stays open, so the admin can dismiss it or delete it instead.
    if (
      action === ReportAction.Hide &&
      !(await this.contentExists(targetType, targetId))
    ) {
      throw new ConflictException(reportedContentGoneMessage(targetType));
    }

    const status = REPORT_ACTION_STATUS[action];
    const resolvedAt = new Date();
    const resolved = await this.reports.resolve(
      id,
      status,
      adminId,
      resolvedAt,
    );
    if (!resolved) {
      throw new ConflictException(REPORT_ALREADY_RESOLVED_MESSAGE);
    }

    if (action === ReportAction.Dismiss) {
      // GEN-07: the report is the target; the note names what it was about.
      await this.audit.record({
        adminId,
        action: AuditAction.DismissReport,
        targetType: AuditTargetType.Report,
        targetId: id,
        details: `${targetType} ${targetId}`,
      });
      return toAdminReportResponse(resolved);
    }
    let images: string[] = [];
    if (action === ReportAction.Hide) {
      // False when it was already hidden: the goal holds, so that is fine.
      await this.setHidden(targetType, targetId, true);
    } else {
      // Null when it is already gone: deleting is idempotent.
      images = (await this.removeContent(targetType, targetId)) ?? [];
    }
    await this.reports.resolveOpenOfTarget(
      targetType,
      targetId,
      status,
      adminId,
      resolvedAt,
    );
    // GEN-07: the content is the target; the note names the report.
    await this.audit.record({
      adminId,
      action:
        action === ReportAction.Hide
          ? AuditAction.HideContent
          : AuditAction.DeleteContent,
      targetType: CONTENT_AUDIT_TARGET[targetType],
      targetId,
      details: `report ${id}`,
    });
    await this.deleteImages(images);
    return toAdminReportResponse(resolved);
  }

  /**
   * GEN-10: hides a post or an itinerary directly, or shows it again. 404
   * when it does not exist, 409 when it already has that state. Hiding also
   * resolves its open reports as `hidden`. Showing it again does not reopen
   * reports that were already resolved.
   */
  async moderateContent(
    type: ReportTargetType,
    id: string,
    moderation: ContentModeration,
    adminId: string,
  ): Promise<ContentModerationResponseDto> {
    const hidden = moderation === ContentModeration.Hidden;
    const changed = await this.setHidden(type, id, hidden);
    if (!changed) {
      if (!(await this.contentExists(type, id))) {
        throw new NotFoundException(CONTENT_NOT_FOUND_MESSAGE[type]);
      }
      throw new ConflictException(alreadyModeratedMessage(type, moderation));
    }
    if (hidden) {
      await this.reports.resolveOpenOfTarget(
        type,
        id,
        ReportStatus.Hidden,
        adminId,
        new Date(),
      );
    }
    await this.audit.record({
      adminId,
      action: hidden ? AuditAction.HideContent : AuditAction.ShowContent,
      targetType: CONTENT_AUDIT_TARGET[type],
      targetId: id,
    });
    return { type, id, moderation };
  }

  /**
   * GEN-10: deletes a post or an itinerary directly, with its image files.
   * 404 when it does not exist. Its open reports are resolved as `deleted`;
   * every report stays in the collection as history.
   */
  async deleteContent(
    type: ReportTargetType,
    id: string,
    adminId: string,
  ): Promise<void> {
    const images = await this.removeContent(type, id);
    if (images === null) {
      throw new NotFoundException(CONTENT_NOT_FOUND_MESSAGE[type]);
    }
    await this.reports.resolveOpenOfTarget(
      type,
      id,
      ReportStatus.Deleted,
      adminId,
      new Date(),
    );
    await this.audit.record({
      adminId,
      action: AuditAction.DeleteContent,
      targetType: CONTENT_AUDIT_TARGET[type],
      targetId: id,
    });
    await this.deleteImages(images);
  }

  private contentExists(type: ReportTargetType, id: string): Promise<boolean> {
    return type === ReportTargetType.Post
      ? this.posts.existsById(id)
      : this.itineraries.existsById(id);
  }

  /** False when nothing changed: missing, or already in that state. */
  private setHidden(
    type: ReportTargetType,
    id: string,
    hidden: boolean,
  ): Promise<boolean> {
    return type === ReportTargetType.Post
      ? this.posts.setHidden(id, hidden)
      : this.itineraries.setHidden(id, hidden);
  }

  /** The image files to delete, or null when the content did not exist. */
  private removeContent(
    type: ReportTargetType,
    id: string,
  ): Promise<string[] | null> {
    return type === ReportTargetType.Post
      ? this.posts.removeByAdmin(id)
      : this.itineraries.removeByAdmin(id);
  }

  /**
   * Deletes the image files of deleted content (GEN-08). It runs last and
   * never throws: the content is already gone, so a file that cannot be
   * removed is logged (the count only) instead of failing the request.
   */
  private async deleteImages(images: string[]): Promise<void> {
    const results = await Promise.allSettled(
      images.map((image) => this.uploads.deleteImage(image)),
    );
    const failed = results.filter(
      (result) => result.status === 'rejected',
    ).length;
    if (failed > 0) {
      this.logger.warn(
        `Could not delete ${failed} image file(s) of deleted content`,
      );
    }
  }
}
