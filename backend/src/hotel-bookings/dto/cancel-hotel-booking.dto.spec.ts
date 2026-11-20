import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { CancelHotelBookingDto } from './cancel-hotel-booking.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CancelHotelBookingDto,
};
const messagesOf = async (body: unknown): Promise<string[]> => {
  try {
    await pipe.transform(body, metadata);
    return [];
  } catch (error) {
    return (error as { response: { message: string[] } }).response.message;
  }
};

describe('CancelHotelBookingDto (HTL-21)', () => {
  it.each([0, 50, 100])('accepts %p', async (expectedRefundPercent) => {
    expect(await messagesOf({ expectedRefundPercent })).toEqual([]);
  });

  it.each([
    [{}, 'expectedRefundPercent is required'],
    [
      { expectedRefundPercent: 50.5 },
      'expectedRefundPercent must be a whole number',
    ],
    [
      { expectedRefundPercent: '50' },
      'expectedRefundPercent must be a whole number',
    ],
    [{ expectedRefundPercent: -1 }, 'expectedRefundPercent must be 0 or more'],
    [
      { expectedRefundPercent: 101 },
      'expectedRefundPercent must be at most 100',
    ],
  ])('refuses %p', async (body, message) => {
    expect(await messagesOf(body)).toContain(message);
  });

  it('refuses a field the client may not send, such as a refund amount', async () => {
    expect(
      await messagesOf({ expectedRefundPercent: 50, refundAmount: 1 }),
    ).toContain('property refundAmount should not exist');
  });
});
