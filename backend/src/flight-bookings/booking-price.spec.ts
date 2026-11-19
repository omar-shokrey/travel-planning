import type { PlannedPassenger } from './booking-passengers';
import { fareTotalOf, infantFareOf, priceBooking } from './booking-price';
import { PassengerType } from './enums/passenger-type.enum';

const passenger = (type: PassengerType, baggageFee = 0): PlannedPassenger => ({
  fullName: 'Test Passenger',
  dateOfBirth: '1990-01-01',
  passportNumber: 'A1234567',
  type,
  baggageFee,
});

/** A plan as planPassengers returns it, with the counts and seats it derives. */
const planOf = (passengers: PlannedPassenger[]) => {
  const count = (type: PassengerType) =>
    passengers.filter((item) => item.type === type).length;
  const counts = {
    adults: count(PassengerType.Adult),
    children: count(PassengerType.Child),
    infants: count(PassengerType.Infant),
  };
  return { passengers, counts, seats: counts.adults + counts.children };
};

describe('priceBooking (FLT-21)', () => {
  it('prices 2 adults, 1 child and 1 infant with bags', () => {
    const plan = planOf([
      passenger(PassengerType.Adult, 9000),
      passenger(PassengerType.Adult),
      passenger(PassengerType.Child, 4500),
      passenger(PassengerType.Infant),
    ]);

    expect(priceBooking(25000, plan)).toEqual({
      fareTotal: 3 * 25000 + 2500,
      baggageTotal: 13500,
      total: 3 * 25000 + 2500 + 13500,
      perPassenger: [
        { fare: 25000, baggageFee: 9000 },
        { fare: 25000, baggageFee: 0 },
        { fare: 25000, baggageFee: 4500 },
        { fare: 2500, baggageFee: 0 },
      ],
    });
  });

  it('rounds the infant fare to a whole minor unit (12345 -> 1235)', () => {
    const plan = planOf([
      passenger(PassengerType.Adult),
      passenger(PassengerType.Infant),
    ]);

    const price = priceBooking(12345, plan);

    expect(price.perPassenger[1].fare).toBe(1235);
    expect(price.fareTotal).toBe(12345 + 1235);
  });

  it('gives a baggage total of 0 without bags', () => {
    const price = priceBooking(
      25000,
      planOf([passenger(PassengerType.Adult), passenger(PassengerType.Child)]),
    );

    expect(price.baggageTotal).toBe(0);
    expect(price.total).toBe(price.fareTotal);
  });

  it('keeps the passengers in the order of the request', () => {
    const price = priceBooking(
      10000,
      planOf([
        passenger(PassengerType.Infant),
        passenger(PassengerType.Adult, 300),
        passenger(PassengerType.Child),
      ]),
    );

    expect(price.perPassenger.map(({ fare }) => fare)).toEqual([
      1000, 10000, 10000,
    ]);
    expect(price.perPassenger[1].baggageFee).toBe(300);
  });

  it('agrees with fareTotalOf and gives only whole numbers', () => {
    for (const fare of [1, 9, 12345, 25005, 99999]) {
      const plan = planOf([
        passenger(PassengerType.Adult, 4500),
        passenger(PassengerType.Child),
        passenger(PassengerType.Infant),
      ]);
      const price = priceBooking(fare, plan);

      expect(price.fareTotal).toBe(fareTotalOf(fare, 2, 1));
      expect(price.fareTotal).toBe(
        price.perPassenger.reduce((sum, item) => sum + item.fare, 0),
      );
      for (const amount of [
        price.fareTotal,
        price.baggageTotal,
        price.total,
        ...price.perPassenger.flatMap((item) => [item.fare, item.baggageFee]),
      ]) {
        expect(Number.isInteger(amount)).toBe(true);
      }
      expect(price.perPassenger[2].fare).toBe(infantFareOf(fare));
    }
  });
});
