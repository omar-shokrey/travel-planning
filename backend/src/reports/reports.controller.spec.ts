import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ReportStatus } from './enums/report-status.enum';
import { ReportTargetType } from './enums/report-target-type.enum';
import { ReportsController } from './reports.controller';
import type { ReportsService } from './reports.service';

describe('ReportsController (GEN-09)', () => {
  const dto = {
    targetType: ReportTargetType.Post,
    targetId: '6745a1b2c3d4e5f6a7b8c9d0',
    reason: 'Spam links',
  };

  it('passes the body and the logged-in user id to the service and returns its answer', async () => {
    const report = {
      id: 'report-1',
      ...dto,
      status: ReportStatus.Open,
      createdAt: '2026-11-16T10:00:00.000Z',
    };
    const service = { create: jest.fn().mockResolvedValue(report) };
    const controller = new ReportsController(
      service as unknown as ReportsService,
    );

    expect(await controller.create(dto, 'user-1')).toBe(report);
    expect(service.create).toHaveBeenCalledWith(dto, 'user-1');
  });

  it('is POST /reports for the user role only', () => {
    const handler = ReportsController.prototype.create;

    expect(Reflect.getMetadata(PATH_METADATA, ReportsController)).toBe(
      'reports',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(new Reflector().get<Role[] | undefined>(ROLES_KEY, handler)).toEqual(
      [Role.User],
    );
  });
});
