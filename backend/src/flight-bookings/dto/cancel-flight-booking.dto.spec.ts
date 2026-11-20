import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CancelFlightBookingDto } from './cancel-flight-booking.dto';

async function messagesOf(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(CancelFlightBookingDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('CancelFlightBookingDto (FLT-26)', () => {
  it.each([0, 50, 100])('accepts %p', async (expectedRefundPercent) => {
    await expect(messagesOf({ expectedRefundPercent })).resolves.toEqual([]);
  });

  it('needs expectedRefundPercent', async () => {
    await expect(messagesOf({})).resolves.toContain(
      'expectedRefundPercent is required',
    );
  });

  it.each([
    [12.5, 'expectedRefundPercent must be a whole number'],
    ['50', 'expectedRefundPercent must be a whole number'],
    [-1, 'expectedRefundPercent must be 0 or more'],
    [101, 'expectedRefundPercent must be at most 100'],
  ])('refuses %p', async (expectedRefundPercent, message) => {
    await expect(messagesOf({ expectedRefundPercent })).resolves.toContain(
      message,
    );
  });

  it('refuses any other field, such as a refund amount', async () => {
    await expect(
      messagesOf({ expectedRefundPercent: 50, refundAmount: 100 }),
    ).resolves.toContain('property refundAmount should not exist');
  });
});
