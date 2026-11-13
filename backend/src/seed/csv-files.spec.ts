import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mongoose } from 'mongoose';
import { Airport, AirportSchema } from '../reference/models/airport.schema';
import {
  Attraction,
  AttractionSchema,
} from '../reference/models/attraction.schema';
import { City, CitySchema } from '../reference/models/city.schema';
import { Country, CountrySchema } from '../reference/models/country.schema';
import { loadReferenceData } from './csv-files';
import { findProblems, type ReferenceData } from './reference-data';

const files = {
  'countries.csv': 'code,name,currency\nEG,Egypt,EGP\nFR,France,EUR\n',
  'cities.csv': 'city_id,name,country_code\ncairo,Cairo,EG\nparis,Paris,FR\n',
  'airports.csv':
    'iata_code,name,city_id,country_code,time_zone\nCAI,Cairo International Airport,cairo,EG,Africa/Cairo\n',
  'attractions.csv':
    'attraction_id,name,city_id\natt-1,Giza Pyramids and Sphinx,cairo\n',
};

describe('loadReferenceData', () => {
  let directory: string;

  const write = (overrides: Record<string, string> = {}) => {
    for (const [name, content] of Object.entries({ ...files, ...overrides })) {
      writeFileSync(join(directory, name), content);
    }
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'reference-data-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('maps the CSV columns to the model fields', () => {
    write();

    const data = loadReferenceData(directory);

    expect(data.countries[0].record).toEqual({
      _id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(data.cities[1].record).toEqual({
      _id: 'paris',
      name: 'Paris',
      countryCode: 'FR',
    });
    expect(data.airports[0].record).toEqual({
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
    expect(data.attractions[0].record).toEqual({
      _id: 'att-1',
      name: 'Giza Pyramids and Sphinx',
      cityId: 'cairo',
    });
  });

  it('counts the header as line 1', () => {
    write();

    expect(loadReferenceData(directory).countries.map((e) => e.line)).toEqual([
      2, 3,
    ]);
  });

  it('reads a file with a BOM, Windows line endings and no final newline', () => {
    write({ 'countries.csv': '﻿code,name,currency\r\nEG,Egypt,EGP' });

    expect(loadReferenceData(directory).countries[0].record._id).toBe('EG');
  });

  it('names the file when a column is missing', () => {
    write({ 'cities.csv': 'city_id,name\ncairo,Cairo\n' });

    expect(() => loadReferenceData(directory)).toThrow(
      'cities.csv: missing column "country_code"',
    );
  });

  it('names the file when a row has the wrong number of values', () => {
    write({ 'cities.csv': 'city_id,name,country_code\ncairo,Cairo\n' });

    expect(() => loadReferenceData(directory)).toThrow(/^cities\.csv: /);
  });

  it('names the file when it has no rows', () => {
    write({ 'attractions.csv': 'attraction_id,name,city_id\n' });

    expect(() => loadReferenceData(directory)).toThrow(
      'attractions.csv: the file has no rows',
    );
  });

  it('names the file when it is missing', () => {
    write();
    rmSync(join(directory, 'airports.csv'));

    expect(() => loadReferenceData(directory)).toThrow(/^airports\.csv: /);
  });
});

describe('the official reference data', () => {
  const mongoose = new Mongoose();
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  const CountryModel = mongoose.model(Country.name, CountrySchema);
  const CityModel = mongoose.model(City.name, CitySchema);
  const AirportModel = mongoose.model(Airport.name, AirportSchema);
  const AttractionModel = mongoose.model(Attraction.name, AttractionSchema);

  let data: ReferenceData;

  beforeAll(() => {
    data = loadReferenceData();
  });

  it('has rows in every file', () => {
    expect(data.countries.length).toBeGreaterThan(0);
    expect(data.cities.length).toBeGreaterThan(0);
    expect(data.airports.length).toBeGreaterThan(0);
    expect(data.attractions.length).toBeGreaterThan(0);
  });

  it('is consistent across the four files', () => {
    expect(findProblems(data)).toEqual([]);
  });

  it('passes the validation of the models', async () => {
    const validations = [
      ...data.countries.map(({ record }) =>
        new CountryModel(record).validate(),
      ),
      ...data.cities.map(({ record }) => new CityModel(record).validate()),
      ...data.airports.map(({ record }) => new AirportModel(record).validate()),
      ...data.attractions.map(({ record }) =>
        new AttractionModel(record).validate(),
      ),
    ];

    await expect(Promise.all(validations)).resolves.toHaveLength(
      validations.length,
    );
  });
});
