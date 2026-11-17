import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PostModeration } from '../blog/models/post-moderation.enum';
import type { PostsService } from '../blog/posts.service';
import type { ItinerariesService } from '../itineraries/itineraries.service';
import { ReportStatus } from './enums/report-status.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import {
  ALREADY_REPORTED_MESSAGE,
  OWN_CONTENT_MESSAGE,
  REPORT_NOT_FOUND_MESSAGE,
  ReportsService,
} from './reports.service';

const REPORTER = new Types.ObjectId().toString();
const AUTHOR = new Types.ObjectId().toString();
const TARGET = new Types.ObjectId().toString();
const CREATED_AT = new Date('2026-11-16T10:00:00.000Z');

function setup() {
  const reportId = new Types.ObjectId();
  const reports = {
    create: jest.fn().mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve({
        ...data,
        _id: reportId,
        status: ReportStatus.Open,
        createdAt: CREATED_AT,
      }),
    ),
  };
  const posts = {
    findPublishedSummary: jest.fn().mockResolvedValue({
      authorId: AUTHOR,
      moderation: PostModeration.Visible,
    }),
  };
  // The itineraries module applies ITN-21's "publicly visible" rule.
  const itineraries = {
    findOwnerAndVisibilityOrThrow: jest
      .fn()
      .mockResolvedValue({ ownerId: AUTHOR, publiclyVisible: true }),
  };
  const service = new ReportsService(
    reports as never,
    posts as unknown as PostsService,
    itineraries as unknown as ItinerariesService,
  );
  return { service, reports, posts, itineraries, reportId };
}

const postDto = {
  targetType: ReportTargetType.Post,
  targetId: TARGET,
  reason: 'Spam links',
};
const itineraryDto = { ...postDto, targetType: ReportTargetType.Itinerary };

describe('ReportsService (GEN-09)', () => {
  describe('a report that is saved', () => {
    it('reports a published post of someone else, with status open', async () => {
      const { service, reports, posts, reportId } = setup();

      const result = await service.create(postDto, REPORTER);

      expect(posts.findPublishedSummary).toHaveBeenCalledWith(TARGET);
      expect(reports.create).toHaveBeenCalledWith({
        reporterId: new Types.ObjectId(REPORTER),
        targetType: ReportTargetType.Post,
        targetId: new Types.ObjectId(TARGET),
        reason: 'Spam links',
      });
      expect(result).toEqual({
        id: reportId.toString(),
        targetType: 'post',
        targetId: TARGET,
        reason: 'Spam links',
        status: 'open',
        createdAt: '2026-11-16T10:00:00.000Z',
      });
      expect(result).not.toHaveProperty('reporterId');
    });

    it('reports a public itinerary of someone else', async () => {
      const { service, itineraries, reports } = setup();

      const result = await service.create(itineraryDto, REPORTER);

      expect(itineraries.findOwnerAndVisibilityOrThrow).toHaveBeenCalledWith(
        TARGET,
      );
      expect(reports.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: ReportTargetType.Itinerary }),
      );
      expect(result.targetType).toBe('itinerary');
    });

    it('saves the reporter, the target and the reason, with no read first', async () => {
      const { service, reports } = setup();

      await service.create(postDto, REPORTER);

      expect(reports.create).toHaveBeenCalledWith({
        reporterId: new Types.ObjectId(REPORTER),
        targetType: ReportTargetType.Post,
        targetId: new Types.ObjectId(TARGET),
        reason: postDto.reason,
      });
    });
  });

  describe('a target that is not visible', () => {
    it('answers 404 for a missing or draft post', async () => {
      const { service, posts, reports } = setup();
      posts.findPublishedSummary.mockResolvedValue(null);

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new NotFoundException('Post not found'),
      );
      expect(reports.create).not.toHaveBeenCalled();
    });

    it('answers 404 for a post of someone else that an admin hid (GEN-10)', async () => {
      const { service, posts, reports } = setup();
      posts.findPublishedSummary.mockResolvedValue({
        authorId: AUTHOR,
        moderation: PostModeration.Hidden,
      });

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new NotFoundException('Post not found'),
      );
      expect(reports.create).not.toHaveBeenCalled();
    });

    it('passes on the 404 of a missing itinerary', async () => {
      const { service, itineraries } = setup();
      itineraries.findOwnerAndVisibilityOrThrow.mockRejectedValue(
        new NotFoundException('Itinerary not found'),
      );

      await expect(service.create(itineraryDto, REPORTER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers 404 for an itinerary of someone else that is not publicly visible (private, hidden or by a deactivated author)', async () => {
      const { service, itineraries, reports } = setup();
      itineraries.findOwnerAndVisibilityOrThrow.mockResolvedValue({
        ownerId: AUTHOR,
        publiclyVisible: false,
      });

      await expect(service.create(itineraryDto, REPORTER)).rejects.toThrow(
        new NotFoundException('Itinerary not found'),
      );
      expect(reports.create).not.toHaveBeenCalled();
    });
  });

  describe('own content', () => {
    it('refuses my own published post with 400', async () => {
      const { service, posts, reports } = setup();
      posts.findPublishedSummary.mockResolvedValue({
        authorId: REPORTER,
        moderation: PostModeration.Visible,
      });

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new BadRequestException(OWN_CONTENT_MESSAGE),
      );
      expect(reports.create).not.toHaveBeenCalled();
    });

    it('refuses my own post with 400, even a hidden one: its author still sees it', async () => {
      const { service, posts } = setup();
      posts.findPublishedSummary.mockResolvedValue({
        authorId: REPORTER,
        moderation: PostModeration.Hidden,
      });

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new BadRequestException(OWN_CONTENT_MESSAGE),
      );
    });

    it('refuses my own itinerary with 400, even a private one', async () => {
      const { service, itineraries } = setup();
      itineraries.findOwnerAndVisibilityOrThrow.mockResolvedValue({
        ownerId: REPORTER,
        publiclyVisible: false,
      });

      await expect(service.create(itineraryDto, REPORTER)).rejects.toThrow(
        new BadRequestException(OWN_CONTENT_MESSAGE),
      );
    });
  });

  describe('at most once per item', () => {
    it('answers 409 when the unique index refuses a second report, earlier or at the same moment', async () => {
      const { service, reports } = setup();
      reports.create.mockRejectedValue(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new ConflictException(ALREADY_REPORTED_MESSAGE),
      );
    });

    it('passes on any other database error', async () => {
      const { service, reports } = setup();
      const failure = new Error('connection lost');
      reports.create.mockRejectedValue(failure);

      await expect(service.create(postDto, REPORTER)).rejects.toBe(failure);
    });
  });
});

describe('ReportsService, admin methods (GEN-10)', () => {
  const ADMIN = new Types.ObjectId().toString();
  const RESOLVED_AT = new Date('2026-11-17T09:30:00.000Z');

  /** A query whose chain (sort, skip, limit) ends in `result`. */
  function chain(result: unknown) {
    return {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function setup(model: Record<string, unknown>) {
    return new ReportsService(
      model as never,
      {} as unknown as PostsService,
      {} as unknown as ItinerariesService,
    );
  }

  describe('findEntityOrThrow', () => {
    it('returns the report', async () => {
      const report = { _id: new Types.ObjectId() };
      const findById = jest.fn().mockReturnValue(chain(report));

      expect(await setup({ findById }).findEntityOrThrow('r1')).toBe(report);
      expect(findById).toHaveBeenCalledWith('r1');
    });

    it('answers 404 for an unknown report', async () => {
      const findById = jest.fn().mockReturnValue(chain(null));

      await expect(setup({ findById }).findEntityOrThrow('r1')).rejects.toThrow(
        new NotFoundException(REPORT_NOT_FOUND_MESSAGE),
      );
    });
  });

  describe('listForAdmin', () => {
    it('filters on the status, sorts oldest first and counts the same filter', async () => {
      const query = chain(['a']);
      const find = jest.fn().mockReturnValue(query);
      const countDocuments = jest.fn().mockReturnValue(chain(1));

      const result = await setup({ find, countDocuments }).listForAdmin(
        { status: ReportStatus.Open },
        { skip: 0, limit: 10 },
      );

      expect(result).toEqual({ items: ['a'], total: 1 });
      expect(find).toHaveBeenCalledWith({ status: 'open' });
      expect(countDocuments).toHaveBeenCalledWith({ status: 'open' });
      expect(query.sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
      expect(query.limit).toHaveBeenCalledWith(10);
      // Nothing to skip on the first page, so .skip() is not called.
      expect(query.skip).not.toHaveBeenCalled();
    });

    it('adds the target type and skips to the page', async () => {
      const query = chain([]);
      const find = jest.fn().mockReturnValue(query);
      const countDocuments = jest.fn().mockReturnValue(chain(0));

      await setup({ find, countDocuments }).listForAdmin(
        { status: ReportStatus.Hidden, targetType: ReportTargetType.Post },
        { skip: 20, limit: 10 },
      );

      expect(find).toHaveBeenCalledWith({
        status: 'hidden',
        targetType: 'post',
      });
      expect(query.skip).toHaveBeenCalledWith(20);
    });
  });

  describe('resolve', () => {
    it('changes only a report that is still open, and returns it', async () => {
      const resolved = { _id: new Types.ObjectId() };
      const findOneAndUpdate = jest.fn().mockReturnValue(chain(resolved));

      const result = await setup({ findOneAndUpdate }).resolve(
        'r1',
        ReportStatus.Hidden,
        ADMIN,
        RESOLVED_AT,
      );

      expect(result).toBe(resolved);
      expect(findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'r1', status: ReportStatus.Open },
        {
          $set: {
            status: ReportStatus.Hidden,
            resolvedBy: new Types.ObjectId(ADMIN),
            resolvedAt: RESOLVED_AT,
          },
        },
        { returnDocument: 'after' },
      );
    });

    it('returns null when the report is no longer open', async () => {
      const findOneAndUpdate = jest.fn().mockReturnValue(chain(null));

      expect(
        await setup({ findOneAndUpdate }).resolve(
          'r1',
          ReportStatus.Dismissed,
          ADMIN,
          RESOLVED_AT,
        ),
      ).toBeNull();
    });
  });

  describe('resolveOpenOfTarget', () => {
    it('resolves the open reports of one item only, and counts them', async () => {
      const updateMany = jest.fn().mockReturnValue(chain({ modifiedCount: 2 }));

      const changed = await setup({ updateMany }).resolveOpenOfTarget(
        ReportTargetType.Itinerary,
        TARGET,
        ReportStatus.Deleted,
        ADMIN,
        RESOLVED_AT,
      );

      expect(changed).toBe(2);
      expect(updateMany).toHaveBeenCalledWith(
        {
          targetType: ReportTargetType.Itinerary,
          targetId: new Types.ObjectId(TARGET),
          status: ReportStatus.Open,
        },
        {
          $set: {
            status: ReportStatus.Deleted,
            resolvedBy: new Types.ObjectId(ADMIN),
            resolvedAt: RESOLVED_AT,
          },
        },
      );
    });
  });
});
