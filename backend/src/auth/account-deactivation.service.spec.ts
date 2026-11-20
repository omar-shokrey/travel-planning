import {
  BadRequestException,
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import { Types } from 'mongoose';
import type { PostsService } from '../blog/posts.service';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import type { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import type { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import type { ItinerariesService } from '../itineraries/itineraries.service';
import type { UsersService } from '../users/users.service';
import { AccountDeactivationService } from './account-deactivation.service';
import {
  ACCOUNT_CHANGED_MESSAGE,
  ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE,
  ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE,
  CURRENT_PASSWORD_INCORRECT_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './auth.constants';
import type { SessionsService } from './sessions.service';

const USER_ID = '6740f1c2a4b5c6d7e8f90123';
const userObjectId = new Types.ObjectId(USER_ID);
const PASSWORD = 'Passw0rdOK';

/** A real bcrypt hash of the password above. Few rounds, so the tests stay fast. */
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash(PASSWORD, 4);
});

interface Answers {
  role?: Role;
  status?: UserStatus;
  missing?: boolean;
  confirmedFlight?: boolean;
  confirmedHotel?: boolean;
  flightHold?: boolean;
  hotelHold?: boolean;
  deactivated?: boolean;
  revokeFails?: boolean;
}

function setup(answers: Answers = {}) {
  const user = {
    _id: userObjectId,
    role: answers.role ?? Role.User,
    status: answers.status ?? UserStatus.Active,
    passwordHash,
  };
  const users = {
    findEntityByIdWithPasswordHash: jest
      .fn()
      .mockResolvedValue(answers.missing ? null : user),
    deactivateOwnAccount: jest
      .fn()
      .mockResolvedValue(
        answers.deactivated === false
          ? null
          : { ...user, status: UserStatus.Deactivated },
      ),
  };
  const flightBookings = {
    hasConfirmedBooking: jest
      .fn()
      .mockResolvedValue(answers.confirmedFlight ?? false),
    hasLiveHold: jest.fn().mockResolvedValue(answers.flightHold ?? false),
  };
  const hotelBookings = {
    hasConfirmedBooking: jest
      .fn()
      .mockResolvedValue(answers.confirmedHotel ?? false),
    hasLiveHold: jest.fn().mockResolvedValue(answers.hotelHold ?? false),
  };
  const posts = {
    markAuthorDeactivated: jest.fn().mockResolvedValue(undefined),
  };
  const itineraries = {
    markOwnerDeactivated: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    revokeAllOfUser: answers.revokeFails
      ? jest.fn().mockRejectedValue(new Error('the database is down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new AccountDeactivationService(
    users as unknown as UsersService,
    flightBookings as unknown as FlightBookingsService,
    hotelBookings as unknown as HotelBookingsService,
    posts as unknown as PostsService,
    itineraries as unknown as ItinerariesService,
    sessions as unknown as SessionsService,
  );
  return {
    service,
    users,
    flightBookings,
    hotelBookings,
    posts,
    itineraries,
    sessions,
  };
}

type Setup = ReturnType<typeof setup>;

/** Asserts that nothing was hidden, changed or ended. */
function expectNothingChanged({
  posts,
  itineraries,
  users,
  sessions,
}: Setup): void {
  expect(posts.markAuthorDeactivated).not.toHaveBeenCalled();
  expect(itineraries.markOwnerDeactivated).not.toHaveBeenCalled();
  expect(users.deactivateOwnAccount).not.toHaveBeenCalled();
  expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
}

describe('AccountDeactivationService (ACC-12)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('success', () => {
    it('hides the posts and the itineraries, then deactivates, then ends every session, in that order', async () => {
      const ctx = setup();
      const { service, users, posts, itineraries, sessions } = ctx;

      await expect(
        service.deactivate(USER_ID, { currentPassword: PASSWORD }),
      ).resolves.toBeUndefined();

      expect(posts.markAuthorDeactivated).toHaveBeenCalledWith(USER_ID);
      expect(itineraries.markOwnerDeactivated).toHaveBeenCalledWith(USER_ID);
      expect(users.deactivateOwnAccount).toHaveBeenCalledWith(
        userObjectId,
        expect.any(Date),
      );
      // Every session, none kept: no third argument.
      expect(sessions.revokeAllOfUser).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Date),
      );
      expect(sessions.revokeAllOfUser.mock.calls[0]).toHaveLength(2);

      const order = [
        posts.markAuthorDeactivated,
        itineraries.markOwnerDeactivated,
        users.deactivateOwnAccount,
        sessions.revokeAllOfUser,
      ].map((fn) => fn.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('uses one moment for the hold check, the status change and the sessions', async () => {
      const { service, flightBookings, hotelBookings, users, sessions } =
        setup();

      await service.deactivate(USER_ID, { currentPassword: PASSWORD });

      const [, flightNow] = flightBookings.hasLiveHold.mock.calls[0] as [
        string,
        Date,
      ];
      const [, hotelNow] = hotelBookings.hasLiveHold.mock.calls[0] as [
        string,
        Date,
      ];
      const [, statusNow] = users.deactivateOwnAccount.mock.calls[0] as [
        Types.ObjectId,
        Date,
      ];
      const [, sessionsNow] = sessions.revokeAllOfUser.mock.calls[0] as [
        string,
        Date,
      ];
      expect(hotelNow).toBe(flightNow);
      expect(statusNow).toBe(flightNow);
      expect(sessionsNow).toBe(flightNow);
    });

    it('checks the bookings of the logged-in user only, after the password', async () => {
      const { service, users, flightBookings, hotelBookings } = setup();

      await service.deactivate(USER_ID, { currentPassword: PASSWORD });

      expect(users.findEntityByIdWithPasswordHash).toHaveBeenCalledWith(
        USER_ID,
      );
      expect(flightBookings.hasConfirmedBooking).toHaveBeenCalledWith(USER_ID);
      expect(hotelBookings.hasConfirmedBooking).toHaveBeenCalledWith(USER_ID);
      expect(flightBookings.hasLiveHold).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Date),
      );
      expect(hotelBookings.hasLiveHold).toHaveBeenCalledWith(
        USER_ID,
        expect.any(Date),
      );
    });

    it('still succeeds when ending the sessions fails, and logs it without the password or the hash', async () => {
      const errorLog = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { service, users } = setup({ revokeFails: true });

      await expect(
        service.deactivate(USER_ID, { currentPassword: PASSWORD }),
      ).resolves.toBeUndefined();

      expect(users.deactivateOwnAccount).toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(errorLog.mock.calls[0]);
      expect(logged).toContain(USER_ID);
      expect(logged).not.toContain(PASSWORD);
      expect(logged).not.toContain(passwordHash);
    });
  });

  describe('refusals', () => {
    it('answers 400 for a wrong password and touches no booking, post, itinerary, status or session', async () => {
      const ctx = setup();

      await expect(
        ctx.service.deactivate(USER_ID, { currentPassword: 'Wr0ngPassword' }),
      ).rejects.toThrow(
        new BadRequestException(CURRENT_PASSWORD_INCORRECT_MESSAGE),
      );

      expect(ctx.flightBookings.hasConfirmedBooking).not.toHaveBeenCalled();
      expect(ctx.hotelBookings.hasConfirmedBooking).not.toHaveBeenCalled();
      expect(ctx.flightBookings.hasLiveHold).not.toHaveBeenCalled();
      expect(ctx.hotelBookings.hasLiveHold).not.toHaveBeenCalled();
      expectNothingChanged(ctx);
    });

    it.each([
      ['a confirmed flight booking', { confirmedFlight: true }],
      ['a confirmed hotel reservation', { confirmedHotel: true }],
      ['both', { confirmedFlight: true, confirmedHotel: true }],
      [
        'a confirmed booking and a live hold',
        { confirmedHotel: true, flightHold: true },
      ],
    ])(
      'answers 409 for %s, and hides and changes nothing',
      async (_label, answers) => {
        const ctx = setup(answers);

        await expect(
          ctx.service.deactivate(USER_ID, { currentPassword: PASSWORD }),
        ).rejects.toThrow(
          new ConflictException(ACCOUNT_HAS_CONFIRMED_BOOKINGS_MESSAGE),
        );
        expectNothingChanged(ctx);
      },
    );

    it.each([
      ['a live flight hold', { flightHold: true }],
      ['a live hotel hold', { hotelHold: true }],
    ])(
      'answers 409 with the unpaid message for %s, and hides and changes nothing',
      async (_label, answers) => {
        const ctx = setup(answers);

        await expect(
          ctx.service.deactivate(USER_ID, { currentPassword: PASSWORD }),
        ).rejects.toThrow(
          new ConflictException(ACCOUNT_HAS_UNPAID_BOOKING_MESSAGE),
        );
        expectNothingChanged(ctx);
      },
    );

    it('answers 409 when the account changed before the status change, and ends no session', async () => {
      const { service, posts, sessions } = setup({ deactivated: false });

      await expect(
        service.deactivate(USER_ID, { currentPassword: PASSWORD }),
      ).rejects.toThrow(new ConflictException(ACCOUNT_CHANGED_MESSAGE));

      // The hiding came first and can be repeated.
      expect(posts.markAuthorDeactivated).toHaveBeenCalled();
      expect(sessions.revokeAllOfUser).not.toHaveBeenCalled();
    });

    it.each([
      ['no account', { missing: true }],
      ['an administrator', { role: Role.Admin }],
      ['a hotel moderator', { role: Role.HotelModerator }],
      ['an airline moderator', { role: Role.AirlineModerator }],
      ['a suspended account', { status: UserStatus.Suspended }],
      ['a deactivated account', { status: UserStatus.Deactivated }],
    ])(
      'answers 401 for %s and checks nothing else',
      async (_label, answers) => {
        const ctx = setup(answers);

        await expect(
          ctx.service.deactivate(USER_ID, { currentPassword: PASSWORD }),
        ).rejects.toThrow(new UnauthorizedException(LOGIN_REQUIRED_MESSAGE));

        expect(ctx.flightBookings.hasConfirmedBooking).not.toHaveBeenCalled();
        expectNothingChanged(ctx);
      },
    );
  });
});
