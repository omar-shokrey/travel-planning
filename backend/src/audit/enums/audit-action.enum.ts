/**
 * What an administrator did (GEN-07). Recorded today: `ResetPassword`
 * (ACC-07a), `CreateModerator` (ACC-13), `SuspendUser` and `ReactivateUser`
 * (ACC-15, ACC-16), `DeactivateProvider` and `ReactivateProvider` (ACC-15).
 * The report actions are reserved for GEN-10, which adds its own
 * `AuditService.record` calls.
 */
export enum AuditAction {
  ResetPassword = 'reset_password',
  CreateModerator = 'create_moderator',
  SuspendUser = 'suspend_user',
  ReactivateUser = 'reactivate_user',
  DeactivateProvider = 'deactivate_provider',
  ReactivateProvider = 'reactivate_provider',
  DismissReport = 'dismiss_report',
  HideContent = 'hide_content',
  DeleteContent = 'delete_content',
}
