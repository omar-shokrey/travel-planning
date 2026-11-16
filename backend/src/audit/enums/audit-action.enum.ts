/**
 * What an administrator did (GEN-07). Recorded today: `ResetPassword`
 * (ACC-07a) and `CreateModerator` (ACC-13). The others are reserved for the
 * admin actions still being built, which add their own `AuditService.record`
 * call: suspension and reactivation of accounts (ACC-15, ACC-16), provider
 * deactivation (ACC-15) and report handling (GEN-10).
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
