import { Logger } from '@nestjs/common';
import { FlightChangeExpiryService } from './flight-change-expiry.service';
import type { FlightChangeService } from './flight-change.service';

const NOW = new Date('2026-11-20T10:00:00.000Z');

function setup() {
  const changes = {
    expireDueHolds: jest.fn(() => Promise.resolve(2)),
    finishStuck: jest.fn(() => Promise.resolve(1)),
  };
  const service = new FlightChangeExpiryService(
    changes as unknown as FlightChangeService,
  );
  return { service, changes };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('FlightChangeExpiryService (FLT-27)', () => {
  it('expires the ended holds, then finishes the changes left applying', async () => {
    const { service, changes } = setup();

    await expect(service.run(NOW)).resolves.toEqual({
      expired: 2,
      finished: 1,
    });
    expect(changes.expireDueHolds).toHaveBeenCalledWith(NOW);
    expect(changes.finishStuck).toHaveBeenCalledWith(NOW);
  });

  it('logs a failing part and still runs the other one, never throwing', async () => {
    const { service, changes } = setup();
    changes.expireDueHolds.mockRejectedValueOnce(new Error('database down'));

    await expect(service.run(NOW)).resolves.toEqual({
      expired: 0,
      finished: 1,
    });
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'The flight change hold-expiry failed',
      expect.any(String),
    );

    changes.finishStuck.mockRejectedValueOnce(new Error('database down'));
    await expect(service.runJob()).resolves.toBeUndefined();
  });
});
