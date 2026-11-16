import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { PostsService } from '../blog/posts.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import type { ItinerariesService } from '../itineraries/itineraries.service';
import { ReportAction } from '../reports/enums/report-action.enum';
import { ReportStatus } from '../reports/enums/report-status.enum';
import { ReportTargetType } from '../reports/enums/report-target-type.enum';
import type { ReportsService } from '../reports/reports.service';
import type { UploadsService } from '../uploads/uploads.service';
import {
  REPORT_ALREADY_RESOLVED_MESSAGE,
  reportedContentGoneMessage,
} from './admin-moderation.constants';
import { AdminModerationService } from './admin-moderation.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ContentModeration } from './enums/content-moderation.enum';

const ADMIN = new Types.ObjectId().toString();
const REPORT_ID = new Types.ObjectId();
const REPORTER = new Types.ObjectId();
const TARGET = new Types.ObjectId();
const CREATED_AT = new Date('2026-11-16T10:00:00.000Z');

function storedReport(
  targetType = ReportTargetType.Post,
  status = ReportStatus.Open,
) {
  return {
    _id: REPORT_ID,
    reporterId: REPORTER,
    targetType,
    targetId: TARGET,
    reason: 'Spam',
    status,
    createdAt: CREATED_AT,
  };
}

function setup(targetType = ReportTargetType.Post) {
  const reports = {
    listForAdmin: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    findEntityOrThrow: jest.fn().mockResolvedValue(storedReport(targetType)),
    resolve: jest
      .fn()
      .mockImplementation(
        (_id: string, status: ReportStatus, _admin: string, at: Date) =>
          Promise.resolve({
            ...storedReport(targetType),
            status,
            resolvedBy: new Types.ObjectId(ADMIN),
            resolvedAt: at,
          }),
      ),
    resolveOpenOfTarget: jest.fn().mockResolvedValue(0),
  };
  const content = () => ({
    existsById: jest.fn().mockResolvedValue(true),
    setHidden: jest.fn().mockResolvedValue(true),
    removeByAdmin: jest.fn().mockResolvedValue(['a.jpg']),
  });
  const posts = content();
  const itineraries = content();
  const uploads = { deleteImage: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminModerationService(
    reports as unknown as ReportsService,
    posts as unknown as PostsService,
    itineraries as unknown as ItinerariesService,
    uploads as unknown as UploadsService,
  );
  return { service, reports, posts, itineraries, uploads };
}

describe('AdminModerationService (GEN-10)', () => {
  describe('listReports', () => {
    it('passes the filters and the page to ReportsService and maps the items', async () => {
      const { service, reports } = setup();
      reports.listForAdmin.mockResolvedValue({
        items: [storedReport()],
        total: 11,
      });
      const query = Object.assign(new ListReportsQueryDto(), {
        page: 2,
        limit: 10,
        targetType: ReportTargetType.Post,
      });

      const result = await service.listReports(query);

      expect(reports.listForAdmin).toHaveBeenCalledWith(
        { status: ReportStatus.Open, targetType: ReportTargetType.Post },
        { skip: 10, limit: 10 },
      );
      expect(result).toEqual({
        items: [
          {
            id: REPORT_ID.toString(),
            targetType: 'post',
            targetId: TARGET.toString(),
            reason: 'Spam',
            status: 'open',
            createdAt: '2026-11-16T10:00:00.000Z',
            reporterId: REPORTER.toString(),
          },
        ],
        meta: { page: 2, limit: 10, total: 11, totalPages: 2 },
      });
    });

    it('answers an empty page when nothing matches', async () => {
      const { service } = setup();

      const result = await service.listReports(new ListReportsQueryDto());

      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('is a PaginationQueryDto, so the default page applies', () => {
      expect(new ListReportsQueryDto()).toBeInstanceOf(PaginationQueryDto);
    });
  });

  describe('resolveReport', () => {
    it('dismisses a report and leaves the content and the other reports alone', async () => {
      const { service, reports, posts } = setup();

      const result = await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Dismiss,
        ADMIN,
      );

      expect(reports.resolve).toHaveBeenCalledWith(
        REPORT_ID.toString(),
        ReportStatus.Dismissed,
        ADMIN,
        expect.any(Date),
      );
      expect(posts.setHidden).not.toHaveBeenCalled();
      expect(posts.removeByAdmin).not.toHaveBeenCalled();
      expect(reports.resolveOpenOfTarget).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'dismissed',
        resolvedBy: ADMIN,
        resolvedAt: expect.stringMatching(/Z$/),
        reporterId: REPORTER.toString(),
      });
    });

    it('hides the post, then resolves its other open reports as hidden', async () => {
      const { service, reports, posts, uploads } = setup();

      const result = await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Hide,
        ADMIN,
      );

      expect(posts.setHidden).toHaveBeenCalledWith(TARGET.toString(), true);
      const [, , , resolvedAt] = reports.resolve.mock.calls[0] as unknown[];
      expect(reports.resolveOpenOfTarget).toHaveBeenCalledWith(
        ReportTargetType.Post,
        TARGET.toString(),
        ReportStatus.Hidden,
        ADMIN,
        resolvedAt,
      );
      expect(uploads.deleteImage).not.toHaveBeenCalled();
      expect(result.status).toBe('hidden');
    });

    it('claims the report before it touches the content', async () => {
      const { service, reports, posts } = setup();
      const order: string[] = [];
      reports.resolve.mockImplementation(() => {
        order.push('resolve');
        return Promise.resolve({ ...storedReport(), status: 'hidden' });
      });
      posts.setHidden.mockImplementation(() => {
        order.push('hide');
        return Promise.resolve(true);
      });

      await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Hide,
        ADMIN,
      );

      expect(order).toEqual(['resolve', 'hide']);
    });

    it('still resolves the report when the content was already hidden', async () => {
      const { service, posts } = setup();
      posts.setHidden.mockResolvedValue(false);

      const result = await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Hide,
        ADMIN,
      );

      expect(result.status).toBe('hidden');
    });

    it('answers 409 and changes nothing when the content to hide no longer exists', async () => {
      const { service, reports, posts } = setup();
      posts.existsById.mockResolvedValue(false);

      await expect(
        service.resolveReport(REPORT_ID.toString(), ReportAction.Hide, ADMIN),
      ).rejects.toThrow(
        new ConflictException(
          reportedContentGoneMessage(ReportTargetType.Post),
        ),
      );
      expect(reports.resolve).not.toHaveBeenCalled();
      expect(posts.setHidden).not.toHaveBeenCalled();
    });

    it('deletes an itinerary with its images and resolves its other open reports as deleted', async () => {
      const { service, reports, itineraries, posts, uploads } = setup(
        ReportTargetType.Itinerary,
      );
      itineraries.removeByAdmin.mockResolvedValue(['a.jpg', 'b.png']);

      const result = await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Delete,
        ADMIN,
      );

      expect(itineraries.removeByAdmin).toHaveBeenCalledWith(TARGET.toString());
      expect(posts.removeByAdmin).not.toHaveBeenCalled();
      expect(uploads.deleteImage).toHaveBeenCalledWith('a.jpg');
      expect(uploads.deleteImage).toHaveBeenCalledWith('b.png');
      expect(reports.resolveOpenOfTarget).toHaveBeenCalledWith(
        ReportTargetType.Itinerary,
        TARGET.toString(),
        ReportStatus.Deleted,
        ADMIN,
        expect.any(Date),
      );
      expect(result.status).toBe('deleted');
    });

    it('closes the report when the content to delete is already gone (idempotent)', async () => {
      const { service, posts, uploads, reports } = setup();
      posts.removeByAdmin.mockResolvedValue(null);

      const result = await service.resolveReport(
        REPORT_ID.toString(),
        ReportAction.Delete,
        ADMIN,
      );

      expect(result.status).toBe('deleted');
      expect(uploads.deleteImage).not.toHaveBeenCalled();
      expect(reports.resolveOpenOfTarget).toHaveBeenCalled();
    });

    it('does not fail when an image file cannot be removed, and logs the count', async () => {
      const { service, uploads } = setup();
      uploads.deleteImage.mockRejectedValue(new Error('EACCES'));
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        service.resolveReport(REPORT_ID.toString(), ReportAction.Delete, ADMIN),
      ).resolves.toMatchObject({ status: 'deleted' });
      expect(warn).toHaveBeenCalledWith(
        'Could not delete 1 image file(s) of deleted content',
      );
      warn.mockRestore();
    });

    it.each([
      ReportStatus.Dismissed,
      ReportStatus.Hidden,
      ReportStatus.Deleted,
    ])('answers 409 for a report that is already %s', async (status) => {
      const { service, reports, posts } = setup();
      reports.findEntityOrThrow.mockResolvedValue(
        storedReport(ReportTargetType.Post, status),
      );

      await expect(
        service.resolveReport(REPORT_ID.toString(), ReportAction.Delete, ADMIN),
      ).rejects.toThrow(new ConflictException(REPORT_ALREADY_RESOLVED_MESSAGE));
      expect(reports.resolve).not.toHaveBeenCalled();
      expect(posts.removeByAdmin).not.toHaveBeenCalled();
    });

    it('answers 409 and leaves the content alone when another admin resolved it first', async () => {
      const { service, reports, posts } = setup();
      reports.resolve.mockResolvedValue(null);

      await expect(
        service.resolveReport(REPORT_ID.toString(), ReportAction.Delete, ADMIN),
      ).rejects.toThrow(new ConflictException(REPORT_ALREADY_RESOLVED_MESSAGE));
      expect(posts.removeByAdmin).not.toHaveBeenCalled();
      expect(reports.resolveOpenOfTarget).not.toHaveBeenCalled();
    });

    it('passes on the 404 of an unknown report', async () => {
      const { service, reports } = setup();
      reports.findEntityOrThrow.mockRejectedValue(
        new NotFoundException('Report not found'),
      );

      await expect(
        service.resolveReport(REPORT_ID.toString(), ReportAction.Hide, ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('moderateContent', () => {
    it('hides a post and resolves its open reports as hidden', async () => {
      const { service, posts, reports } = setup();

      const result = await service.moderateContent(
        ReportTargetType.Post,
        'post-1',
        ContentModeration.Hidden,
        ADMIN,
      );

      expect(result).toEqual({
        type: 'post',
        id: 'post-1',
        moderation: 'hidden',
      });
      expect(posts.setHidden).toHaveBeenCalledWith('post-1', true);
      expect(reports.resolveOpenOfTarget).toHaveBeenCalledWith(
        ReportTargetType.Post,
        'post-1',
        ReportStatus.Hidden,
        ADMIN,
        expect.any(Date),
      );
    });

    it('shows an itinerary again and leaves the reports alone', async () => {
      const { service, itineraries, reports } = setup();

      const result = await service.moderateContent(
        ReportTargetType.Itinerary,
        'it-1',
        ContentModeration.Visible,
        ADMIN,
      );

      expect(result.moderation).toBe('visible');
      expect(itineraries.setHidden).toHaveBeenCalledWith('it-1', false);
      expect(reports.resolveOpenOfTarget).not.toHaveBeenCalled();
    });

    it('answers 409 when the content already has that state', async () => {
      const { service, posts } = setup();
      posts.setHidden.mockResolvedValue(false);

      await expect(
        service.moderateContent(
          ReportTargetType.Post,
          'post-1',
          ContentModeration.Hidden,
          ADMIN,
        ),
      ).rejects.toThrow(new ConflictException('The post is already hidden'));
    });

    it('answers 404 for content that does not exist', async () => {
      const { service, itineraries, reports } = setup();
      itineraries.setHidden.mockResolvedValue(false);
      itineraries.existsById.mockResolvedValue(false);

      await expect(
        service.moderateContent(
          ReportTargetType.Itinerary,
          'it-1',
          ContentModeration.Hidden,
          ADMIN,
        ),
      ).rejects.toThrow(new NotFoundException('Itinerary not found'));
      expect(reports.resolveOpenOfTarget).not.toHaveBeenCalled();
    });
  });

  describe('deleteContent', () => {
    it('deletes a post, its images, and resolves its open reports as deleted', async () => {
      const { service, posts, uploads, reports } = setup();

      await service.deleteContent(ReportTargetType.Post, 'post-1', ADMIN);

      expect(posts.removeByAdmin).toHaveBeenCalledWith('post-1');
      expect(uploads.deleteImage).toHaveBeenCalledWith('a.jpg');
      expect(reports.resolveOpenOfTarget).toHaveBeenCalledWith(
        ReportTargetType.Post,
        'post-1',
        ReportStatus.Deleted,
        ADMIN,
        expect.any(Date),
      );
    });

    it('answers 404 for content that does not exist', async () => {
      const { service, posts, reports } = setup();
      posts.removeByAdmin.mockResolvedValue(null);

      await expect(
        service.deleteContent(ReportTargetType.Post, 'post-1', ADMIN),
      ).rejects.toThrow(new NotFoundException('Post not found'));
      expect(reports.resolveOpenOfTarget).not.toHaveBeenCalled();
    });
  });
});
