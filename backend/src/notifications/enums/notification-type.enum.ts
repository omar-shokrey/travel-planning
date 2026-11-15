/**
 * Why a user is notified (GEN-01). The values follow the notification model in
 * `specs/travel-platform.md`. A module that needs a new reason adds it here.
 */
export enum NotificationType {
  BookingConfirmed = 'booking_confirmed',
  BookingCancelled = 'booking_cancelled',
  Refund = 'refund',
  FlightChanged = 'flight_changed',
  AccountSuspended = 'account_suspended',
  ProviderDeactivated = 'provider_deactivated',
}
