import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from 'bcrypt';
import { PostsService } from '../blog/posts.service';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { UsersService } from '../users/users.service';
import {
  ACCOUNT_CHANGED_MESSAGE,
  ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE,
  ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './auth.constants';
import type { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { SessionsService } from './sessions.service';

/**
 * ACC-12: a registered user deactivates their own account.
 *
 * The order of the steps is the design. Everything that can refuse comes
 * first (the account, the password, the bookings), so a refusal changes
 * nothing. Then the steps that can be repeated (hiding the posts and the
 * itineraries), then the status change, so a failure part way never leaves
 * an account that is deactivated with its content still public: the user can
 * simply try again. The sessions end last; the guard already refuses a
 * deactivated account, so a failure there is logged and not returned.
 */
@Injectable()
export class AccountDeactivationService {
  private readonly logger = new Logger(AccountDeactivationService.name);

  constructor(
    private readonly users: UsersService,
    private readonly flightBookings: FlightBookingsService,
    private readonly hotelBookings: HotelBookingsService,
    private readonly posts: PostsService,
    private readonly itineraries: ItinerariesService,
    private readonly sessions: SessionsService,
  ) {}

  async deactivate(userId: string, dto: DeactivateAccountDto): Promise<void> {
    // a. The account. The guards have already refused a guest, another role,
    // a suspended account and a temporary password; this is the backstop for
    // an account that changed between the guard and here.
    const user = await this.users.findEntityByIdWithPasswordHash(userId);
    if (!user || user.role !== Role.User || user.status !== UserStatus.Active) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }

    // b. The confirmation: the current password, as ACC-08 checks it. Not
    // counted for the lockout (ACC-05): this route already needs a session.
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException(CURRENT_PASSWORD_INCORRECT_MESSAGE);
    }

    // c. Upcoming confirmed bookings block it (the requirement).
    const [confirmedFlight, confirmedHotel] = await Promise.all([
      this.flightBookings.hasConfirmedBooking(userId),
      this.hotelBookings.hasConfirmedBooking(userId),
    ]);
    if (confirmedFlight || confirmedHotel) {
      throw new ConflictException(ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE);
    }

    // d. So does a hold that a payment could still confirm.
    const now = new Date();
    const [flightHold, hotelHold] = await Promise.all([
      this.flightBookings.hasLiveHold(userId, now),
      this.hotelBookings.hasLiveHold(userId, now),
    ]);
    if (flightHold || hotelHold) {
      throw new ConflictException(ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE);
    }

    // e. Hide the content. Both are idempotent.
    await this.posts.markAuthorDeactivated(userId);
    await this.itineraries.markOwnerDeactivated(userId);

    // f. The status change, only from active.
    const deactivated = await this.users.deactivateOwnAccount(user._id, now);
    if (!deactivated) {
      throw new ConflictException(ACCOUNT_CHANGED_MESSAGE);
    }

    // g. End every session of the account, this one included.
    try {
      await this.sessions.revokeAllOfUser(userId, now);
    } catch (error) {
      this.logger.error(
        `Could not end the sessions of the deactivated account ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
