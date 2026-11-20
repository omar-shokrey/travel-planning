import { Reflector } from '@nestjs/core';
import {
  REQUIRE_VERIFIED_EMAIL_KEY,
  RequireVerifiedEmail,
} from './require-verified-email.decorator';

class SomeController {
  @RequireVerifiedEmail()
  booking(): string {
    return 'ok';
  }

  plain(): string {
    return 'ok';
  }
}

@RequireVerifiedEmail()
class BookingController {
  anyRoute(): string {
    return 'ok';
  }
}

describe('@RequireVerifiedEmail() (ACC-02)', () => {
  const reflector = new Reflector();

  it('marks a handler, and the guard can read it', () => {
    expect(
      reflector.get<boolean>(
        REQUIRE_VERIFIED_EMAIL_KEY,
        SomeController.prototype.booking,
      ),
    ).toBe(true);
  });

  it('leaves a handler without it unmarked', () => {
    expect(
      reflector.get<boolean | undefined>(
        REQUIRE_VERIFIED_EMAIL_KEY,
        SomeController.prototype.plain,
      ),
    ).toBeUndefined();
  });

  it('can mark a whole controller', () => {
    expect(
      reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL_KEY, [
        BookingController.prototype.anyRoute,
        BookingController,
      ]),
    ).toBe(true);
  });
});
