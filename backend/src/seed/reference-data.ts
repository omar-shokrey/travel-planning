export const FILE_NAMES = {
  countries: 'countries.csv',
  cities: 'cities.csv',
  airports: 'airports.csv',
  attractions: 'attractions.csv',
} as const;

export type Fields = Record<string, string>;

export type Entry<T> = { line: number; record: T };

export type CountryRecord = { _id: string; name: string; currency: string };

export type CityRecord = { _id: string; name: string; countryCode: string };

export type AirportRecord = {
  _id: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
};

export type AttractionRecord = { _id: string; name: string; cityId: string };

export type ReferenceData = {
  countries: Entry<CountryRecord>[];
  cities: Entry<CityRecord>[];
  airports: Entry<AirportRecord>[];
  attractions: Entry<AttractionRecord>[];
};

export type Plan<T extends Fields> = {
  insert: T[];
  update: { id: string; changes: Fields }[];
  unchanged: number;
};

const duplicateIds = (
  file: string,
  entries: Entry<{ _id: string }>[],
): string[] => {
  const firstLines = new Map<string, number>();
  const problems: string[] = [];
  for (const { line, record } of entries) {
    const firstLine = firstLines.get(record._id);
    if (firstLine === undefined) {
      firstLines.set(record._id, line);
    } else {
      problems.push(
        `${file} line ${line}: id "${record._id}" is already used on line ${firstLine}`,
      );
    }
  }
  return problems;
};

export const findProblems = (data: ReferenceData): string[] => {
  const countryIds = new Set(data.countries.map(({ record }) => record._id));
  const countryOfCity = new Map(
    data.cities.map(({ record }): [string, string] => [
      record._id,
      record.countryCode,
    ]),
  );
  const problems = [
    ...duplicateIds(FILE_NAMES.countries, data.countries),
    ...duplicateIds(FILE_NAMES.cities, data.cities),
    ...duplicateIds(FILE_NAMES.airports, data.airports),
    ...duplicateIds(FILE_NAMES.attractions, data.attractions),
  ];

  for (const { line, record } of data.cities) {
    if (!countryIds.has(record.countryCode)) {
      problems.push(
        `${FILE_NAMES.cities} line ${line}: country "${record.countryCode}" is not in ${FILE_NAMES.countries}`,
      );
    }
  }

  for (const { line, record } of data.airports) {
    const cityCountry = countryOfCity.get(record.cityId);
    if (cityCountry === undefined) {
      problems.push(
        `${FILE_NAMES.airports} line ${line}: city "${record.cityId}" is not in ${FILE_NAMES.cities}`,
      );
    } else if (cityCountry !== record.countryCode) {
      problems.push(
        `${FILE_NAMES.airports} line ${line}: country "${record.countryCode}" does not match country "${cityCountry}" of city "${record.cityId}"`,
      );
    }
  }

  for (const { line, record } of data.attractions) {
    if (!countryOfCity.has(record.cityId)) {
      problems.push(
        `${FILE_NAMES.attractions} line ${line}: city "${record.cityId}" is not in ${FILE_NAMES.cities}`,
      );
    }
  }

  return problems;
};

export const planChanges = <T extends Fields>(
  wanted: T[],
  existing: readonly object[],
): Plan<T> => {
  const stored = new Map(
    existing.map((doc): [string, Record<string, unknown>] => {
      const fields = doc as Record<string, unknown>;
      return [String(fields._id), fields];
    }),
  );
  const plan: Plan<T> = { insert: [], update: [], unchanged: 0 };

  for (const record of wanted) {
    const doc = stored.get(record._id);
    if (doc === undefined) {
      plan.insert.push(record);
      continue;
    }
    const changes = Object.fromEntries(
      Object.entries(record).filter(
        ([key, value]) => key !== '_id' && doc[key] !== value,
      ),
    );
    if (Object.keys(changes).length === 0) {
      plan.unchanged += 1;
    } else {
      plan.update.push({ id: record._id, changes });
    }
  }

  return plan;
};

export const supportedCurrencies = (
  countries: Entry<CountryRecord>[],
): string[] =>
  [...new Set(countries.map(({ record }) => record.currency))].sort();
