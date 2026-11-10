import { Mongoose } from 'mongoose';
import { Airport, AirportSchema } from './airport.schema';
import { Attraction, AttractionSchema } from './attraction.schema';
import { City, CitySchema } from './city.schema';
import { Country, CountrySchema } from './country.schema';

const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const CountryModel = mongoose.model(Country.name, CountrySchema);
const CityModel = mongoose.model(City.name, CitySchema);
const AirportModel = mongoose.model(Airport.name, AirportSchema);
const AttractionModel = mongoose.model(Attraction.name, AttractionSchema);

type Fields = Record<string, unknown>;
type Validatable = { validate: () => Promise<unknown> };
type Built = Validatable & { id?: unknown };

const country = { _id: 'EG', name: 'Egypt', currency: 'EGP' };
const city = { _id: 'cairo', name: 'Cairo', countryCode: 'EG' };
const airport = {
  _id: 'CAI',
  name: 'Cairo International Airport',
  cityId: 'cairo',
  countryCode: 'EG',
  timeZone: 'Africa/Cairo',
};
const attraction = {
  _id: 'att-1',
  name: 'Giza Pyramids and Sphinx',
  cityId: 'cairo',
};

const invalidFields = (doc: Validatable): Promise<string[]> =>
  doc.validate().then(
    () => [],
    (error: { errors: Record<string, unknown> }) =>
      Object.keys(error.errors).sort(),
  );

const without = (data: Fields, field: string): Fields =>
  Object.fromEntries(Object.entries(data).filter(([key]) => key !== field));

const cases: [string, (data: Fields) => Built, Fields][] = [
  ['country', (data) => new CountryModel(data), country],
  ['city', (data) => new CityModel(data), city],
  ['airport', (data) => new AirportModel(data), airport],
  ['attraction', (data) => new AttractionModel(data), attraction],
];

describe('reference data models', () => {
  it('use the collection names of the data model', () => {
    expect(CountryModel.collection.name).toBe('countries');
    expect(CityModel.collection.name).toBe('cities');
    expect(AirportModel.collection.name).toBe('airports');
    expect(AttractionModel.collection.name).toBe('attractions');
  });

  it.each(cases)(
    '%s accepts an official record',
    async (_name, build, record) => {
      expect(await invalidFields(build(record))).toEqual([]);
    },
  );

  it.each(cases)('%s keeps the official id as _id', (_name, build, record) => {
    expect(build(record).id).toBe(record._id);
  });

  it.each(cases)('%s needs every field', async (_name, build, record) => {
    for (const field of Object.keys(record)) {
      expect(await invalidFields(build(without(record, field)))).toContain(
        field,
      );
    }
  });

  it.each(['Africa/Cairo', 'Asia/Dubai', 'UTC'])(
    'accepts the time zone %s',
    async (timeZone) => {
      expect(
        await invalidFields(new AirportModel({ ...airport, timeZone })),
      ).toEqual([]);
    },
  );

  it.each(['Mars/Phobos', 'Cairo'])(
    'rejects the time zone %s',
    async (timeZone) => {
      expect(
        await invalidFields(new AirportModel({ ...airport, timeZone })),
      ).toEqual(['timeZone']);
    },
  );
});
