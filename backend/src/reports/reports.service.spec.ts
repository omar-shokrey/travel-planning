import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { PostsService } from '../blog/posts.service';
import type { ItinerariesService } from '../itineraries/itineraries.service';
import { ReportStatus } from './enums/report-status.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import {
  ALREADY_REPORTED_MESSAGE,
  OWN_CONTENT_MESSAGE,
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
    findPublishedAuthorId: jest.fn().mockResolvedValue(AUTHOR),
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

      expect(posts.findPublishedAuthorId).toHaveBeenCalledWith(TARGET);
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
      posts.findPublishedAuthorId.mockResolvedValue(null);

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
      posts.findPublishedAuthorId.mockResolvedValue(REPORTER);

      await expect(service.create(postDto, REPORTER)).rejects.toThrow(
        new BadRequestException(OWN_CONTENT_MESSAGE),
      );
      expect(reports.create).not.toHaveBeenCalled();
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
