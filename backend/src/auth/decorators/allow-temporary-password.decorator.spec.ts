import { Reflector } from '@nestjs/core';
import {
  ALLOW_TEMPORARY_PASSWORD_KEY,
  AllowTemporaryPassword,
} from './allow-temporary-password.decorator';

class SomeController {
  @AllowTemporaryPassword()
  allowed(): string {
    return 'ok';
  }

  plain(): string {
    return 'ok';
  }
}

@AllowTemporaryPassword()
class AllowedController {
  anyRoute(): string {
    return 'ok';
  }
}

describe('@AllowTemporaryPassword() (ACC-13, ACC-07a)', () => {
  const reflector = new Reflector();

  it('marks a handler, and the guard can read it', () => {
    expect(
      reflector.get<boolean>(
        ALLOW_TEMPORARY_PASSWORD_KEY,
        SomeController.prototype.allowed,
      ),
    ).toBe(true);
  });

  it('leaves a handler without it unmarked', () => {
    expect(
      reflector.get<boolean | undefined>(
        ALLOW_TEMPORARY_PASSWORD_KEY,
        SomeController.prototype.plain,
      ),
    ).toBeUndefined();
  });

  it('can mark a whole controller', () => {
    expect(
      reflector.getAllAndOverride<boolean>(ALLOW_TEMPORARY_PASSWORD_KEY, [
        AllowedController.prototype.anyRoute,
        AllowedController,
      ]),
    ).toBe(true);
  });
});
