import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import {
  FILE_NAMES,
  type AirportRecord,
  type AttractionRecord,
  type CityRecord,
  type CountryRecord,
  type Entry,
  type Fields,
  type ReferenceData,
} from './reference-data';

export const REFERENCE_DATA_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'requirements',
  'reference-data',
);

type Source<T> = {
  file: string;
  columns: string[];
  toRecord: (values: Fields) => T;
};

const countries: Source<CountryRecord> = {
  file: FILE_NAMES.countries,
  columns: ['code', 'name', 'currency'],
  toRecord: (values) => ({
    _id: values.code,
    name: values.name,
    currency: values.currency,
  }),
};

const cities: Source<CityRecord> = {
  file: FILE_NAMES.cities,
  columns: ['city_id', 'name', 'country_code'],
  toRecord: (values) => ({
    _id: values.city_id,
    name: values.name,
    countryCode: values.country_code,
  }),
};

const airports: Source<AirportRecord> = {
  file: FILE_NAMES.airports,
  columns: ['iata_code', 'name', 'city_id', 'country_code', 'time_zone'],
  toRecord: (values) => ({
    _id: values.iata_code,
    name: values.name,
    cityId: values.city_id,
    countryCode: values.country_code,
    timeZone: values.time_zone,
  }),
};

const attractions: Source<AttractionRecord> = {
  file: FILE_NAMES.attractions,
  columns: ['attraction_id', 'name', 'city_id'],
  toRecord: (values) => ({
    _id: values.attraction_id,
    name: values.name,
    cityId: values.city_id,
  }),
};

const readRows = (directory: string, file: string): Fields[] => {
  try {
    return parse(readFileSync(join(directory, file), 'utf8'), {
      columns: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${file}: ${reason}`);
  }
};

const readEntries = <T>(
  directory: string,
  { file, columns, toRecord }: Source<T>,
): Entry<T>[] => {
  const rows = readRows(directory, file);
  if (rows.length === 0) {
    throw new Error(`${file}: the file has no rows`);
  }
  const missing = columns.filter((column) => !(column in rows[0]));
  if (missing.length > 0) {
    const names = missing.map((column) => `"${column}"`).join(', ');
    throw new Error(`${file}: missing column ${names}`);
  }
  return rows.map((values, index) => ({
    line: index + 2,
    record: toRecord(values),
  }));
};

export const loadReferenceData = (
  directory: string = REFERENCE_DATA_DIR,
): ReferenceData => ({
  countries: readEntries(directory, countries),
  cities: readEntries(directory, cities),
  airports: readEntries(directory, airports),
  attractions: readEntries(directory, attractions),
});
