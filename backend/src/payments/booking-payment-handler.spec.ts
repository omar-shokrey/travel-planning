import { paymentHandlerOf, paymentHandlersOf } from './booking-payment-handler';
import { BookingType } from './enums/booking-type.enum';

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

describe('paymentHandlersOf (PAY-01, FLT-27)', () => {
  const flightBookings = { confirmPaid: jest.fn() };
  const hotelBookings = { confirmPaid: jest.fn() };

  it('maps flight and hotel to their booking services', () => {
    const handlers = paymentHandlersOf(flightBookings, hotelBookings);

    expect(handlers[BookingType.Flight]).toBe(flightBookings);
    expect(handlers[BookingType.Hotel]).toBe(hotelBookings);
  });

  it('has no flight_change handler while no flight change port is provided', () => {
    const handlers = paymentHandlersOf(flightBookings, hotelBookings);

    expect(handlers[BookingType.FlightChange]).toBeUndefined();
  });

  it('confirms a flight_change with the port, never with the flight booking service', async () => {
    const port = { confirmPaid: jest.fn().mockResolvedValue(true) };

    const handlers = paymentHandlersOf(flightBookings, hotelBookings, port);

    expect(handlers[BookingType.FlightChange]).toBe(port);
    await handlers[BookingType.FlightChange]?.confirmPaid('change', new Date());
    expect(port.confirmPaid).toHaveBeenCalledWith('change', expect.any(Date));
    expect(flightBookings.confirmPaid).not.toHaveBeenCalled();
  });
});
