import {
  findProblems,
  planChanges,
  supportedCurrencies,
  type ReferenceData,
} from './reference-data';

const entry = <T>(line: number, record: T) => ({ line, record });

const consistent = (): ReferenceData => ({
  countries: [
    entry(2, { _id: 'EG', name: 'Egypt', currency: 'EGP' }),
    entry(3, { _id: 'FR', name: 'France', currency: 'EUR' }),
    entry(4, { _id: 'DE', name: 'Germany', currency: 'EUR' }),
  ],
  cities: [
    entry(2, { _id: 'cairo', name: 'Cairo', countryCode: 'EG' }),
    entry(3, { _id: 'paris', name: 'Paris', countryCode: 'FR' }),
  ],
  airports: [
    entry(2, {
      _id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    }),
  ],
  attractions: [
    entry(2, {
      _id: 'att-1',
      name: 'Giza Pyramids and Sphinx',
      cityId: 'cairo',
    }),
  ],
});

describe('findProblems', () => {
  it('finds nothing in consistent data', () => {
    expect(findProblems(consistent())).toEqual([]);
  });

  it('reports a repeated id with both line numbers', () => {
    const data = consistent();
    data.countries.push(
      entry(5, { _id: 'EG', name: 'Egypt', currency: 'EGP' }),
    );

    expect(findProblems(data)).toEqual([
      'countries.csv line 5: id "EG" is already used on line 2',
    ]);
  });

  it('reports a city whose country does not exist', () => {
    const data = consistent();
    data.cities.push(
      entry(4, { _id: 'rome', name: 'Rome', countryCode: 'IT' }),
    );

    expect(findProblems(data)).toEqual([
      'cities.csv line 4: country "IT" is not in countries.csv',
    ]);
  });

  it('reports an airport whose city does not exist', () => {
    const data = consistent();
    data.airports.push(
      entry(3, {
        _id: 'FCO',
        name: 'Fiumicino',
        cityId: 'rome',
        countryCode: 'IT',
        timeZone: 'Europe/Rome',
      }),
    );

    expect(findProblems(data)).toEqual([
      'airports.csv line 3: city "rome" is not in cities.csv',
    ]);
  });

  it('reports an airport whose country differs from the country of its city', () => {
    const data = consistent();
    data.airports.push(
      entry(3, {
        _id: 'CDG',
        name: 'Charles de Gaulle Airport',
        cityId: 'paris',
        countryCode: 'DE',
        timeZone: 'Europe/Paris',
      }),
    );

    expect(findProblems(data)).toEqual([
      'airports.csv line 3: country "DE" does not match country "FR" of city "paris"',
    ]);
  });

  it('reports an attraction whose city does not exist', () => {
    const data = consistent();
    data.attractions.push(
      entry(3, { _id: 'att-9', name: 'Colosseum', cityId: 'rome' }),
    );

    expect(findProblems(data)).toEqual([
      'attractions.csv line 3: city "rome" is not in cities.csv',
    ]);
  });
});

describe('planChanges', () => {
  const egypt = { _id: 'EG', name: 'Egypt', currency: 'EGP' };
  const stored = {
    ...egypt,
    createdAt: new Date(),
    updatedAt: new Date(),
    __v: 0,
  };

  it('adds a record that is not in the database yet', () => {
    expect(planChanges([egypt], [])).toEqual({
      insert: [egypt],
      update: [],
      unchanged: 0,
    });
  });

  it('leaves a matching record alone, whatever extra fields it has', () => {
    expect(planChanges([egypt], [stored])).toEqual({
      insert: [],
      update: [],
      unchanged: 1,
    });
  });

  it('updates only the fields that differ', () => {
    const changed = { ...stored, name: 'Arab Republic of Egypt' };

    expect(planChanges([egypt], [changed])).toEqual({
      insert: [],
      update: [{ id: 'EG', changes: { name: 'Egypt' } }],
      unchanged: 0,
    });
  });

  it('never plans to remove a record that is not in the files', () => {
    const other = { _id: 'XX', name: 'Elsewhere', currency: 'XXX' };

    expect(planChanges([egypt], [stored, other])).toEqual({
      insert: [],
      update: [],
      unchanged: 1,
    });
  });

  it('has nothing left to do once its own plan is applied', () => {
    const database: Record<string, unknown>[] = [];
    const wanted = [egypt, { _id: 'FR', name: 'France', currency: 'EUR' }];

    const first = planChanges(wanted, database);
    database.push(...first.insert);
    const second = planChanges(wanted, database);

    expect(first.insert).toHaveLength(2);
    expect(second).toEqual({ insert: [], update: [], unchanged: 2 });
  });
});

describe('supportedCurrencies', () => {
  it('lists each currency once, in alphabetical order', () => {
    expect(supportedCurrencies(consistent().countries)).toEqual(['EGP', 'EUR']);
  });
});
