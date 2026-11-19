import { paymentHandlerOf } from './booking-payment-handler';

describe('paymentHandlerOf (PAY-01)', () => {
  it('is undefined for a booking service that cannot confirm a payment yet', () => {
    expect(paymentHandlerOf({ hold: jest.fn() })).toBeUndefined();
  });

  it('is the service itself once it has confirmPaid (FLT-23, HTL-17)', async () => {
    const service = { confirmPaid: jest.fn().mockResolvedValue(true) };

    const handler = paymentHandlerOf(service);

    expect(handler).toBe(service);
    await expect(handler?.confirmPaid('id', new Date())).resolves.toBe(true);
  });
});
