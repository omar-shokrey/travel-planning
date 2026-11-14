const TEST_SUFFIX = '-test';
const URI_PARTS = /^(mongodb(?:\+srv)?:\/\/[^/?]+\/)([^/?]*)(.*)$/;

export function toTestDatabaseUri(uri: string): string {
  const parts = URI_PARTS.exec(uri);
  if (!parts || !parts[2]) {
    throw new Error(
      'MONGODB_URI must name a database, for example .../travel-planning?retryWrites=true',
    );
  }
  const [, start, database, rest] = parts;
  const name = database.endsWith(TEST_SUFFIX)
    ? database
    : `${database}${TEST_SUFFIX}`;
  return `${start}${name}${rest}`;
}
