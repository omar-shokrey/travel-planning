import { toAirportResponse } from './airport.mapper';

const airport = {
  _id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryCode: 'EG',
  timeZone: 'Africa/Cairo',
};

describe('toAirportResponse', () => {
  it('returns the IATA code, name, city, country and time zone', () => {
    expect(
      toAirportResponse(
        airport,
        new Map([['cairo', 'Cairo']]),
        new Map([['EG', 'Egypt']]),
      ),
    ).toEqual({
      code: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      cityName: 'Cairo',
      countryCode: 'EG',
      countryName: 'Egypt',
      timeZone: 'Africa/Cairo',
    });
  });

  it('shows the id when a city or country name is missing', () => {
    const response = toAirportResponse(airport, new Map(), new Map());

    expect(response.cityName).toBe('cairo');
    expect(response.countryName).toBe('EG');
  });

  it('leaves out internal fields', () => {
    const response = toAirportResponse(
      { ...airport, createdAt: new Date() } as typeof airport,
      new Map(),
      new Map(),
    );

    expect(response).not.toHaveProperty('_id');
    expect(response).not.toHaveProperty('createdAt');
  });
});
