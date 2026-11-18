import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFlightDto } from './create-flight.dto';

describe('CreateFlightDto', () => {
  const validData = {
    flightNumber: 'MS123',
    departureAirport: 'CAI',
    arrivalAirport: 'JFK',
    departureLocal: '2027-06-15T14:30',
    arrivalLocal: '2027-06-15T18:30',
  };

  async function validateDto(data: Record<string, unknown>) {
    const dto = plainToInstance(CreateFlightDto, data);
    return validate(dto);
  }

  it('accepts valid flight data', async () => {
    const errors = await validateDto(validData);

    expect(errors).toHaveLength(0);
  });

  it('trims and uppercases flight number and airport codes', async () => {
    const dto = plainToInstance(CreateFlightDto, {
      ...validData,
      flightNumber: ' ms123 ',
      departureAirport: ' cai ',
      arrivalAirport: ' jfk ',
    });

    expect(dto.flightNumber).toBe('MS123');
    expect(dto.departureAirport).toBe('CAI');
    expect(dto.arrivalAirport).toBe('JFK');

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects a flight number shorter than 2 characters', async () => {
    const errors = await validateDto({
      ...validData,
      flightNumber: 'A',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects a flight number longer than 10 characters', async () => {
    const errors = await validateDto({
      ...validData,
      flightNumber: 'ABCDEFGHIJK',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects a flight number containing special characters', async () => {
    const errors = await validateDto({
      ...validData,
      flightNumber: 'MS-123',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects an airport code that is not three letters', async () => {
    const errors = await validateDto({
      ...validData,
      departureAirport: 'CA',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects a local datetime with Z', async () => {
    const errors = await validateDto({
      ...validData,
      departureLocal: '2027-06-15T14:30Z',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects a local datetime with a timezone offset', async () => {
    const errors = await validateDto({
      ...validData,
      departureLocal: '2027-06-15T14:30+02:00',
    });

    expect(errors).not.toHaveLength(0);
  });

  it('accepts local datetime with seconds', async () => {
    const errors = await validateDto({
      ...validData,
      departureLocal: '2027-06-15T14:30:45',
      arrivalLocal: '2027-06-15T18:30:45',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid local datetime', async () => {
    const errors = await validateDto({
      ...validData,
      departureLocal: 'not-a-date',
    });

    expect(errors).not.toHaveLength(0);
  });
});
