import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PostModeration } from '../blog/models/post-moderation.enum';
import { PostsService } from '../blog/posts.service';
import { ItinerariesService } from '../itineraries/itineraries.service';
import type { CreateReportDto } from './dto/create-report.dto';
import type { ReportResponseDto } from './dto/report-response.dto';
import { ReportStatus } from './enums/report-status.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import { toReportResponse } from './mappers/report.mapper';
import { Report, type ReportDocument } from './models/report.schema';

/** MongoDB error E11000: the unique (reporter, target) index was violated. */
const MONGO_DUPLICATE_KEY = 11000;

export const OWN_CONTENT_MESSAGE = 'You cannot report your own content';
export const ALREADY_REPORTED_MESSAGE = 'You have already reported this item';
export const REPORT_NOT_FOUND_MESSAGE = 'Report not found';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    private readonly posts: PostsService,
    private readonly itineraries: ItinerariesService,
  ) {}

  /**
   * GEN-09: a registered user reports a post or an itinerary with a reason,
   * at most once per item. The target must be visible to the reporter (404
   * otherwise) and must not be the reporter's own (400).
   */
  async create(
    dto: CreateReportDto,
    reporterId: string,
  ): Promise<ReportResponseDto> {
    const ownerId = await this.findVisibleTargetOwnerOrThrow(
      dto.targetType,
      dto.targetId,
      reporterId,
    );
    if (ownerId === reporterId) {
      throw new BadRequestException(OWN_CONTENT_MESSAGE);
    }

    // No read first: the unique (reporter, target) index refuses a second
    // report, including two sent at the same moment, and E11000 becomes 409.
    try {
      const report = await this.reports.create({
        reporterId: new Types.ObjectId(reporterId),
        targetType: dto.targetType,
        targetId: new Types.ObjectId(dto.targetId),
        reason: dto.reason,
      });
      return toReportResponse(report);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(ALREADY_REPORTED_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * GEN-10, for the admin module: a report as an entity, or 404. Never
   * returned by a controller.
   */
  async findEntityOrThrow(id: string): Promise<ReportDocument> {
    const report = await this.reports.findById(id).exec();
    if (!report) {
      throw new NotFoundException(REPORT_NOT_FOUND_MESSAGE);
    }
    return report;
  }

  /**
   * GEN-10, for the admin module: one page of reports with this status (and
   * this target type, when given), oldest first, so the reports that have
   * waited longest come first. `_id` breaks ties, so the order is stable.
   */
  async listForAdmin(
    criteria: { status: ReportStatus; targetType?: ReportTargetType },
    page: { skip: number; limit: number },
  ): Promise<{ items: ReportDocument[]; total: number }> {
    const filter = {
      status: criteria.status,
      ...(criteria.targetType && { targetType: criteria.targetType }),
    };
    let query = this.reports.find(filter).sort({ createdAt: 1, _id: 1 });
    // .skip() only past the first page: in earlier local e2e runs against
    // the Atlas test database, a sorted find with .skip(0) and a filter
    // sometimes never answered. Skipping nothing is the same result.
    if (page.skip > 0) {
      query = query.skip(page.skip);
    }
    const [items, total] = await Promise.all([
      query.limit(page.limit).exec(),
      this.reports.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /**
   * GEN-10, for the admin module: resolves a report that is still open, in
   * one conditional update, and returns it. Returns null when it is no longer
   * open, so of two admins at the same moment only the first one wins.
   */
  async resolve(
    id: string,
    status: ReportStatus,
    adminId: string,
    resolvedAt: Date,
  ): Promise<ReportDocument | null> {
    return this.reports
      .findOneAndUpdate(
        { _id: id, status: ReportStatus.Open },
        {
          $set: {
            status,
            resolvedBy: new Types.ObjectId(adminId),
            resolvedAt,
          },
        },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /**
   * GEN-10, for the admin module: after an item was hidden or deleted, its
   * other open reports get the same status. The filter always names one item,
   * never a broad set. Returns how many reports changed.
   */
  async resolveOpenOfTarget(
    targetType: ReportTargetType,
    targetId: string,
    status: ReportStatus,
    adminId: string,
    resolvedAt: Date,
  ): Promise<number> {
    const result = await this.reports
      .updateMany(
        {
          targetType,
          targetId: new Types.ObjectId(targetId),
          status: ReportStatus.Open,
        },
        {
          $set: {
            status,
            resolvedBy: new Types.ObjectId(adminId),
            resolvedAt,
          },
        },
      )
      .exec();
    return result.modifiedCount;
  }

  /**
   * The owner of the target, as a string id. Throws 404 when the target is
   * missing or the reporter may not see it, so hidden content is never
   * revealed by the answer.
   */
  private async findVisibleTargetOwnerOrThrow(
    targetType: ReportTargetType,
    targetId: string,
    reporterId: string,
  ): Promise<string> {
    if (targetType === ReportTargetType.Post) {
      // A draft answers like a missing post (BLG-01, BLG-02), and so does a
      // post an admin hid, except to its author (GEN-10).
      const post = await this.posts.findPublishedSummary(targetId);
      const visibleToReporter =
        post !== null &&
        (post.moderation === PostModeration.Visible ||
          post.authorId === reporterId);
      if (!visibleToReporter) {
        throw new NotFoundException('Post not found');
      }
      return post.authorId;
    }

    // Another user sees an itinerary only while it is publicly visible: public
    // (ITN-20), not hidden by an admin (GEN-10) and its author active
    // (ACC-12). The rule is ITN-21's own (`PUBLICLY_VISIBLE`), applied by the
    // itineraries module, so search and reports cannot disagree.
    const { ownerId, publiclyVisible } =
      await this.itineraries.findOwnerAndVisibilityOrThrow(targetId);
    if (ownerId !== reporterId && !publiclyVisible) {
      throw new NotFoundException('Itinerary not found');
    }
    return ownerId;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
