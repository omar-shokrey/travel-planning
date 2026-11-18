/**
 * The kind of record an admin action touched (GEN-07). `User` is any account
 * (users and moderators alike). `Airline` and `Hotel` are providers (ACC-15).
 * The others are reported or moderated content and the reports (GEN-10).
 */
export enum AuditTargetType {
  User = 'user',
  Airline = 'airline',
  Hotel = 'hotel',
  Report = 'report',
  Post = 'post',
  Comment = 'comment',
  Review = 'review',
  Itinerary = 'itinerary',
}
