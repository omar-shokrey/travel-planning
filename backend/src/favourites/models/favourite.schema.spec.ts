import { model, Types } from 'mongoose';
import { FavouriteSchema } from './favourite.schema';

// Validation runs in memory: no database is opened.
const FavouriteModel = model('FavouriteSchemaSpec', FavouriteSchema);

const favourite = (fields: Record<string, unknown> = {}) =>
  new FavouriteModel({
    userId: new Types.ObjectId(),
    targetType: 'hotel',
    targetId: new Types.ObjectId(),
    ...fields,
  });

const invalidPaths = (doc: ReturnType<typeof favourite>): string[] =>
  Object.keys(doc.validateSync()?.errors ?? {});

describe('Favourite schema (BON-02)', () => {
  it('is stored in the favourites collection, with timestamps', () => {
    expect(FavouriteModel.collection.collectionName).toBe('favourites');
    expect(FavouriteSchema.get('timestamps')).toBe(true);
  });

  it.each(['hotel', 'itinerary'])('accepts a %s', (targetType) => {
    expect(favourite({ targetType }).validateSync()).toBeUndefined();
  });

  it.each([
    ['targetType', { targetType: 'flight' }],
    ['targetType', { targetType: undefined }],
    ['targetId', { targetId: undefined }],
    ['userId', { userId: undefined }],
  ])('refuses a wrong or missing %s', (path, fields) => {
    expect(invalidPaths(favourite(fields))).toContain(path);
  });

  it('has one favourite per user and target, and the list index of a user, newest first, and no other index', () => {
    expect(FavouriteSchema.indexes()).toEqual([
      [{ userId: 1, targetType: 1, targetId: 1 }, { unique: true }],
      [{ userId: 1, createdAt: -1 }, {}],
    ]);
  });
});
