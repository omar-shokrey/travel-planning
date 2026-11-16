import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PostsService } from '../blog/posts.service';
import { ItineraryModeration } from '../itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from '../itineraries/enums/itinerary-visibility.enum';
import { ItinerariesService } from '../itineraries/itineraries.service';
import type { CreateReportDto } from './dto/create-report.dto';
import type { ReportResponseDto } from './dto/report-response.dto';
import { ReportTargetType } from './enums/report-target-type.enum';
import { toReportResponse } from './mappers/report.mapper';
import { Report } from './models/report.schema';

/** MongoDB error E11000: the unique (reporter, target) index was violated. */
const MONGO_DUPLICATE_KEY = 11000;

export const OWN_CONTENT_MESSAGE = 'You cannot report your own content';
export const ALREADY_REPORTED_MESSAGE = 'You have already reported this item';

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

    const key = {
      reporterId: new Types.ObjectId(reporterId),
      targetType: dto.targetType,
      targetId: new Types.ObjectId(dto.targetId),
    };
    // The friendly check. Two requests at the same moment both pass it, and
    // the unique index then refuses the second one (caught below). A count,
    // not exists(): a findOne that matched a report stalled against the Atlas
    // test database, while the count answers at once (and is 0 or 1 here).
    if ((await this.reports.countDocuments(key).exec()) > 0) {
      throw new ConflictException(ALREADY_REPORTED_MESSAGE);
    }

    try {
      const report = await this.reports.create({ ...key, reason: dto.reason });
      return toReportResponse(report);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(ALREADY_REPORTED_MESSAGE);
      }
      throw error;
    }
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
      // A draft answers like a missing post (BLG-01, BLG-02).
      const authorId = await this.posts.findPublishedAuthorId(targetId);
      if (authorId === null) {
        throw new NotFoundException('Post not found');
      }
      return authorId;
    }

    const itinerary = await this.itineraries.findEntityOrThrow(targetId);
    const ownerId = itinerary.ownerId.toString();
    // Another user sees an itinerary only while it is public (ITN-20), not
    // hidden by an admin (GEN-10) and its author is active (ACC-12): the same
    // rule as public search (ITN-21).
    const visibleToOthers =
      itinerary.visibility === ItineraryVisibility.Public &&
      itinerary.moderation === ItineraryModeration.Visible &&
      !itinerary.authorDeactivated;
    if (ownerId !== reporterId && !visibleToOthers) {
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
