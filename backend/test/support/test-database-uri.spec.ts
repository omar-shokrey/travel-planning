import { toTestDatabaseUri } from './test-database-uri';

describe('toTestDatabaseUri', () => {
  it('adds -test to the database name and keeps the rest', () => {
    expect(
      toTestDatabaseUri(
        'mongodb+srv://u:p@cluster.example.net/travel-planning?retryWrites=true&w=majority',
      ),
    ).toBe(
      'mongodb+srv://u:p@cluster.example.net/travel-planning-test?retryWrites=true&w=majority',
    );
  });

  it('works for a local server without options', () => {
    expect(toTestDatabaseUri('mongodb://127.0.0.1:27017/travel-planning')).toBe(
      'mongodb://127.0.0.1:27017/travel-planning-test',
    );
  });

  it('works for several hosts', () => {
    expect(
      toTestDatabaseUri(
        'mongodb://a:27017,b:27017/travel-planning?replicaSet=rs0',
      ),
    ).toBe('mongodb://a:27017,b:27017/travel-planning-test?replicaSet=rs0');
  });

  it('does not add the suffix twice', () => {
    const uri = 'mongodb://127.0.0.1:27017/travel-planning-test';

    expect(toTestDatabaseUri(uri)).toBe(uri);
  });

  it.each([
    'mongodb+srv://u:p@cluster.example.net/?retryWrites=true',
    'mongodb://127.0.0.1:27017',
  ])('refuses a URI without a database name', (uri) => {
    expect(() => toTestDatabaseUri(uri)).toThrow(
      'MONGODB_URI must name a database',
    );
  });

  it('never puts the URI in the error message', () => {
    const uri =
      'mongodb+srv://user:hidden@cluster.example.net/?retryWrites=true';

    expect(() => toTestDatabaseUri(uri)).not.toThrow(/hidden/);
  });
});
