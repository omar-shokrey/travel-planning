/**
 * Roles stored on a user account. A guest has no account, so there is no
 * guest role: a route without @Roles() is open to any logged-in user, and a
 * route marked @Public() is open to guests.
 */
export enum Role {
  User = 'user',
  Admin = 'admin',
  AirlineModerator = 'airline_moderator',
  HotelModerator = 'hotel_moderator',
}
