/**
 * GEN-10: an admin can hide a comment. A hidden comment is left out of the
 * comment list of its post for everyone; its author can still edit or delete
 * it (BLG-07). The same two values as `PostModeration`.
 */
export enum CommentModeration {
  Visible = 'visible',
  Hidden = 'hidden',
}
