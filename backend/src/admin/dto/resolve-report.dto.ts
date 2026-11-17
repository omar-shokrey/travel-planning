import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ReportAction } from '../../reports/enums/report-action.enum';

/**
 * `PATCH /api/admin/reports/:id` (GEN-10). The action is required, `null`
 * included. The status, the admin and the time are set by the server.
 */
export class ResolveReportDto {
  @ApiProperty({
    enum: ReportAction,
    enumName: 'ReportAction',
    example: ReportAction.Hide,
    description:
      'Required. `dismiss` leaves the content as it is; `hide` hides it from everyone but its author and admins; `delete` deletes it. Hiding or deleting also resolves the other open reports of the same content.',
  })
  @IsEnum(ReportAction)
  action: ReportAction;
}
