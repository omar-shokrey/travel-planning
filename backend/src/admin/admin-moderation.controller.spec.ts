import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ReportAction } from '../reports/enums/report-action.enum';
import { ReportTargetType } from '../reports/enums/report-target-type.enum';
import {
  AdminModerationController,
  CONTENT_TYPE_PIPE,
} from './admin-moderation.controller';
import type { AdminModerationService } from './admin-moderation.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ContentModeration } from './enums/content-moderation.enum';

describe('AdminModerationController (GEN-10)', () => {
  function setup() {
    const service = {
      listReports: jest.fn().mockResolvedValue('page'),
      resolveReport: jest.fn().mockResolvedValue('report'),
      viewContent: jest.fn().mockResolvedValue('view'),
      moderateContent: jest.fn().mockResolvedValue('content'),
      deleteContent: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AdminModerationController(
      service as unknown as AdminModerationService,
    );
    return { service, controller };
  }

  it('is under /admin and for administrators only', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminModerationController)).toBe(
      'admin',
    );
    expect(
      new Reflector().get<Role[] | undefined>(
        ROLES_KEY,
        AdminModerationController,
      ),
    ).toEqual([Role.Admin]);
  });

  it.each([
    ['listReports', 'reports', RequestMethod.GET],
    ['resolveReport', 'reports/:id', RequestMethod.PATCH],
    ['viewContent', 'content/:type/:id', RequestMethod.GET],
    ['moderateContent', 'content/:type/:id', RequestMethod.PATCH],
    ['deleteContent', 'content/:type/:id', RequestMethod.DELETE],
  ] as const)('%s is %s', (name, path, method) => {
    const handler = AdminModerationController.prototype[name];

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
  });

  it('answers 204 to a delete', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        AdminModerationController.prototype.deleteContent,
      ),
    ).toBe(204);
  });

  it('passes the query to the service', async () => {
    const { service, controller } = setup();
    const query = new ListReportsQueryDto();

    expect(await controller.listReports(query)).toBe('page');
    expect(service.listReports).toHaveBeenCalledWith(query);
  });

  it('passes the report id, the action and the admin id to the service', async () => {
    const { service, controller } = setup();

    expect(
      await controller.resolveReport(
        'r1',
        { action: ReportAction.Hide },
        'admin-1',
      ),
    ).toBe('report');
    expect(service.resolveReport).toHaveBeenCalledWith(
      'r1',
      ReportAction.Hide,
      'admin-1',
    );
  });

  it('passes the content to view to the service and returns its answer', async () => {
    const { service, controller } = setup();

    expect(await controller.viewContent(ReportTargetType.Comment, 'c1')).toBe(
      'view',
    );
    expect(service.viewContent).toHaveBeenCalledWith(
      ReportTargetType.Comment,
      'c1',
    );
  });

  it('passes the content, the moderation and the admin id to the service', async () => {
    const { service, controller } = setup();

    expect(
      await controller.moderateContent(
        ReportTargetType.Itinerary,
        'it-1',
        { moderation: ContentModeration.Visible },
        'admin-1',
      ),
    ).toBe('content');
    expect(service.moderateContent).toHaveBeenCalledWith(
      ReportTargetType.Itinerary,
      'it-1',
      ContentModeration.Visible,
      'admin-1',
    );
  });

  it('passes the content to delete and the admin id to the service', async () => {
    const { service, controller } = setup();

    await controller.deleteContent(ReportTargetType.Post, 'p1', 'admin-1');

    expect(service.deleteContent).toHaveBeenCalledWith(
      ReportTargetType.Post,
      'p1',
      'admin-1',
    );
  });

  describe('CONTENT_TYPE_PIPE', () => {
    it.each(['post', 'itinerary', 'comment'])('accepts %s', async (type) => {
      expect(
        await CONTENT_TYPE_PIPE.transform(type, {
          type: 'param',
          data: 'type',
        }),
      ).toBe(type);
    });

    it.each(['review', 'POST', ''])('refuses %p with 400', async (type) => {
      await expect(
        CONTENT_TYPE_PIPE.transform(type, { type: 'param', data: 'type' }),
      ).rejects.toThrow(
        new BadRequestException(
          'type must be one of: post, itinerary, comment',
        ),
      );
    });
  });
});
