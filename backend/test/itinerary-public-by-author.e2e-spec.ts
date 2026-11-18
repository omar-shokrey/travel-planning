import './support/auth-env';
import { PaginationQueryDto } from './../src/common/dto/pagination-query.dto';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import { PublicItinerariesService } from './../src/itineraries/public-itineraries.service';
import {
  createItineraryFixture,
  type DetailBody,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';

const page = (fields: Partial<PaginationQueryDto> = {}) =>
  Object.assign(new PaginationQueryDto(), fields);

/**
 * `PublicItinerariesService.listByAuthor` (ITN-21) against the real test
 * database. It has no route of its own: the blog's public author page
 * (BLG-12) uses it, so these tests take the service from the running app.
 */
describe('Public itineraries of one author (e2e, ITN-21, BLG-12)', () => {
  let fixture: ItineraryFixture;
  let service: PublicItinerariesService;
  let author: FixtureUser;
  let otherAuthor: FixtureUser;
  let older: DetailBody;
  let newer: DetailBody;
  let otherAuthorsTrip: DetailBody;

  const setVisibility = (
    owner: FixtureUser,
    itinerary: DetailBody,
    visibility: string,
  ) =>
    fixture
      .http()
      .patch(`/api/itineraries/${itinerary.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility })
      .expect(200);

  const createPublic = async (owner: FixtureUser, title: string) => {
    const itinerary = await fixture.createItinerary(owner, [], title);
    await setVisibility(owner, itinerary, 'public');
    return itinerary;
  };

  const listedIds = async (owner: FixtureUser, fields = {}) =>
    (await service.listByAuthor(owner.id, page(fields))).items.map(
      (item) => item.id,
    );

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    service = fixture.app.get(PublicItinerariesService);
    author = await fixture.createUser();
    otherAuthor = await fixture.createUser();

    older = await createPublic(author, 'Older public trip');
    newer = await createPublic(author, 'Newer public trip');
    // Private: never made public.
    await fixture.createItinerary(author, [], 'Private trip');
    // Public, then hidden by an admin (GEN-10).
    const hidden = await createPublic(author, 'Hidden trip');
    await fixture.itineraries.findByIdAndUpdate(hidden.id, {
      moderation: ItineraryModeration.Hidden,
    });
    // Public, but its author's account is marked deactivated (ACC-12).
    const deactivated = await createPublic(author, 'Deactivated author trip');
    await fixture.itineraries.findByIdAndUpdate(deactivated.id, {
      authorDeactivated: true,
    });
    otherAuthorsTrip = await createPublic(otherAuthor, 'Other author trip');
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  it('lists only the publicly visible itineraries of that author, newest first', async () => {
    const response = await service.listByAuthor(author.id, page());

    expect(response.items.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(response.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(response.items[0]).toEqual(
      expect.objectContaining({
        title: 'Newer public trip',
        visibility: 'public',
        moderation: ItineraryModeration.Visible,
        author: { id: author.id, name: author.name },
      }),
    );
    expect(response.items[0]).not.toHaveProperty('days');
  });

  it("never lists another author's itineraries", async () => {
    expect(await listedIds(otherAuthor)).toEqual([otherAuthorsTrip.id]);
    expect(await listedIds(author)).not.toContain(otherAuthorsTrip.id);
  });

  it('pages through the list with the right total', async () => {
    const response = await service.listByAuthor(
      author.id,
      page({ page: 2, limit: 1 }),
    );

    expect(response.items.map((item) => item.id)).toEqual([older.id]);
    expect(response.meta).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('answers an empty page for an author with no public itinerary', async () => {
    const nobody = await fixture.createUser();

    expect(await service.listByAuthor(nobody.id, page())).toEqual({
      items: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('drops an itinerary made private at once (ITN-20), and lists it again when public', async () => {
    await setVisibility(author, newer, 'private');

    const afterPrivate = await service.listByAuthor(author.id, page());
    expect(afterPrivate.items.map((item) => item.id)).toEqual([older.id]);
    expect(afterPrivate.meta.total).toBe(1);

    await setVisibility(author, newer, 'public');
    expect(await listedIds(author)).toEqual([newer.id, older.id]);
  });
});
