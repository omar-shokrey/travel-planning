import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import {
  ONLY_PUBLIC_ITINERARY_MESSAGE,
  OWN_ITINERARY_ONLY_MESSAGE,
} from './../src/blog/blog.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

interface Summary {
  id: string;
  title: string;
  countries: string[];
  startDate: string;
  dayCount: number;
}

describe('Attach an itinerary to a post (e2e, BLG-13)', () => {
  let fixture: ItineraryFixture;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let author: FixtureUser;
  let other: FixtureUser;
  let adminCookie = '';
  const staff: { id: string; cookie: string; role: Role }[] = [];
  const postIds: string[] = [];

  const http = () => fixture.http();

  const attach = (
    postId: string,
    body: unknown,
    // `null` for a guest: an explicit `undefined` would take the default.
    cookie: string | null = author.cookie,
  ) => {
    const call = http().patch(`/api/posts/${postId}/itinerary`);
    return (cookie ? call.set('Cookie', cookie) : call).send(body as object);
  };
  const page = (postId: string) => http().get(`/api/posts/${postId}`);

  /** A post of `user` made through the API; deleted by id in afterAll. */
  const createPost = async (
    status: 'draft' | 'published',
    user: FixtureUser = author,
  ): Promise<string> => {
    const created = await http()
      .post('/api/posts')
      .set('Cookie', user.cookie)
      .send({
        title: `BLG-13 post ${randomUUID().slice(0, 8)}`,
        body: 'A trip worth reading about.',
        status,
      })
      .expect(201);
    const id = created.body.id as string;
    postIds.push(id);
    return id;
  };

  /** An itinerary of `user` with one day, made public unless asked otherwise. */
  const createItinerary = async (
    user: FixtureUser = author,
    visibility: 'public' | 'private' = 'public',
    title = `BLG-13 trip ${randomUUID().slice(0, 8)}`,
  ) => {
    const itinerary = await fixture.createItinerary(
      user,
      [fixture.cityA],
      title,
    );
    if (visibility === 'public') {
      await setVisibility(itinerary.id, 'public', user);
    }
    return itinerary;
  };
  const setVisibility = (
    id: string,
    visibility: 'public' | 'private',
    user: FixtureUser = author,
  ) =>
    http()
      .patch(`/api/itineraries/${id}`)
      .set('Cookie', user.cookie)
      .send({ visibility })
      .expect(200);
  const moderate = (id: string, moderation: 'hidden' | 'visible') =>
    http()
      .patch(`/api/admin/content/itinerary/${id}`)
      .set('Cookie', adminCookie)
      .send({ moderation })
      .expect(200);

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role) => {
    const user = await users.create({
      name: `BLG-13 ${role}`,
      email: `blg13-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    staff.push({ id, role, cookie: await sessionCookieFor(fixture.app, id) });
    return staff[staff.length - 1].cookie;
  };

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    posts = fixture.app.get<Model<BlogPost>>(getModelToken(BlogPost.name));
    author = await fixture.createUser();
    other = await fixture.createUser();
    adminCookie = await createStaff(Role.Admin);
    await createStaff(Role.HotelModerator);
  });

  afterAll(async () => {
    // Nothing to clean when the setup itself failed (for example no database).
    if (!fixture) return;
    for (const id of postIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const { id } of staff) {
      await deleteSessionsOf(fixture.app, id);
      await users.findByIdAndDelete(id);
    }
    await fixture.cleanup();
  });

  describe('attach, replace and remove', () => {
    it.each(['draft', 'published'] as const)(
      'attaches an own public itinerary to a %s post',
      async (status) => {
        const postId = await createPost(status);
        const itinerary = await createItinerary();

        const response = await attach(postId, { itineraryId: itinerary.id });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          id: postId,
          status,
          itineraryId: itinerary.id,
        });
        const stored = await posts.findById(postId).lean();
        expect(stored?.itineraryId?.toString()).toBe(itinerary.id);
      },
    );

    it('shows the summary on the page of a published post, to a guest too', async () => {
      const postId = await createPost('published');
      const itinerary = await createItinerary(
        author,
        'public',
        'Ten days in the test country',
      );
      await attach(postId, { itineraryId: itinerary.id }).expect(200);

      const response = await page(postId);

      expect(response.status).toBe(200);
      expect(response.body.itinerary).toEqual({
        id: itinerary.id,
        title: 'Ten days in the test country',
        countries: [fixture.country],
        startDate: '2026-12-20',
        dayCount: 1,
      });
    });

    it('lists the attached itinerary id in "my posts"', async () => {
      const postId = await createPost('draft');
      const itinerary = await createItinerary();
      await attach(postId, { itineraryId: itinerary.id }).expect(200);

      const mine = await http()
        .get('/api/posts/mine?limit=50')
        .set('Cookie', author.cookie)
        .expect(200);
      const row = (
        mine.body.items as { id: string; itineraryId: string | null }[]
      ).find((item) => item.id === postId);

      expect(row?.itineraryId).toBe(itinerary.id);
    });

    it('replaces the itinerary, removes it with null, and changes nothing when attached twice', async () => {
      const postId = await createPost('published');
      const first = await createItinerary();
      const second = await createItinerary();

      await attach(postId, { itineraryId: first.id }).expect(200);
      const replaced = await attach(postId, { itineraryId: second.id });
      expect(replaced.status).toBe(200);
      expect(replaced.body.itineraryId).toBe(second.id);
      expect((await page(postId)).body.itinerary.id).toBe(second.id);

      const before = await posts.findById(postId).lean();
      const again = await attach(postId, { itineraryId: second.id });
      expect(again.status).toBe(200);
      expect(again.body.itineraryId).toBe(second.id);
      const after = await posts.findById(postId).lean();
      expect(after?.updatedAt.toISOString()).toBe(
        before?.updatedAt.toISOString(),
      );

      const removed = await attach(postId, { itineraryId: null });
      expect(removed.status).toBe(200);
      expect(removed.body.itineraryId).toBeNull();
      expect((await page(postId)).body.itinerary).toBeNull();
      const stored = await posts.findById(postId).lean();
      expect(stored?.itineraryId).toBeUndefined();
    });
  });

  it('shows only the summary: never days, budget, linked bookings, amounts or the owner', async () => {
    const postId = await createPost('published');
    const itinerary = await createItinerary();
    const dayId = itinerary.days[0].id;
    await http()
      .post(`/api/itineraries/${itinerary.id}/days/${dayId}/budgets`)
      .set('Cookie', author.cookie)
      .send({ category: 'food', amount: 98765, currency: FIXTURE_CURRENCY })
      .expect(201);
    // An owner-only linked booking (ITN-27), stored as the link route stores it.
    await fixture.itineraries.findByIdAndUpdate(itinerary.id, {
      $push: {
        'days.0.linkedBookings': {
          bookingType: 'flight',
          bookingId: new Types.ObjectId(),
          reference: 'FB-BLG13X',
          amount: 52000,
          currency: FIXTURE_CURRENCY,
        },
      },
    });
    await attach(postId, { itineraryId: itinerary.id }).expect(200);

    const response = await page(postId);
    const summary = response.body.itinerary as Summary;

    expect(Object.keys(summary).sort()).toEqual([
      'countries',
      'dayCount',
      'id',
      'startDate',
      'title',
    ]);
    const text = JSON.stringify(response.body);
    for (const secret of [
      'FB-BLG13X',
      '98765',
      '52000',
      'linkedBookings',
      'budget',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(`"ownerId"`);
  });

  describe('which itineraries can be attached', () => {
    it('answers 409 for an own private itinerary', async () => {
      const postId = await createPost('published');
      const itinerary = await createItinerary(author, 'private');

      const response = await attach(postId, { itineraryId: itinerary.id });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(ONLY_PUBLIC_ITINERARY_MESSAGE);
    });

    it('answers 409 for an own public itinerary an admin hid', async () => {
      const postId = await createPost('published');
      const itinerary = await createItinerary();
      await moderate(itinerary.id, 'hidden');

      const response = await attach(postId, { itineraryId: itinerary.id });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(ONLY_PUBLIC_ITINERARY_MESSAGE);
    });

    it("answers 403 for another user's public itinerary and 404 for a missing one", async () => {
      const postId = await createPost('published');
      const others = await createItinerary(other);

      const foreign = await attach(postId, { itineraryId: others.id });
      expect(foreign.status).toBe(403);
      expect(foreign.body.message).toBe(OWN_ITINERARY_ONLY_MESSAGE);

      const missing = await attach(postId, {
        itineraryId: new Types.ObjectId().toString(),
      });
      expect(missing.status).toBe(404);

      const stored = await posts.findById(postId).lean();
      expect(stored?.itineraryId).toBeUndefined();
    });
  });

  describe('who may attach, and the input', () => {
    it("answers 403 for another user's post and 404 for a missing post", async () => {
      const othersPost = await createPost('published', other);
      const itinerary = await createItinerary();

      expect(
        (await attach(othersPost, { itineraryId: itinerary.id })).status,
      ).toBe(403);
      expect(
        (
          await attach(new Types.ObjectId().toString(), {
            itineraryId: itinerary.id,
          })
        ).status,
      ).toBe(404);
    });

    it('answers 401 to a guest, and 403 to an administrator and a moderator', async () => {
      const postId = await createPost('published');
      const itinerary = await createItinerary();

      const guest = await attach(postId, { itineraryId: itinerary.id }, null);
      expect(guest.status).toBe(401);
      expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      for (const { cookie } of staff) {
        expect(
          (await attach(postId, { itineraryId: itinerary.id }, cookie)).status,
        ).toBe(403);
      }
    });

    it.each([
      ['a missing key', {}],
      ['a string that is not an id', { itineraryId: 'abc' }],
      ['a number', { itineraryId: 12 }],
      ['junk', { itineraryId: ['x'] }],
      ['an extra field', { itineraryId: null, authorId: 'me' }],
    ])('answers 400 for %s', async (_name, body) => {
      const postId = await createPost('draft');

      const response = await attach(postId, body);

      expect(response.status).toBe(400);
    });

    it('answers 400 for a post id that is not an id', async () => {
      expect((await attach('not-an-id', { itineraryId: null })).status).toBe(
        400,
      );
    });
  });

  describe('readers see it only while it is publicly visible', () => {
    let postId = '';
    let itineraryId = '';

    beforeAll(async () => {
      postId = await createPost('published');
      itineraryId = (await createItinerary()).id;
      await attach(postId, { itineraryId }).expect(200);
    });

    const shown = async () => {
      const response = await page(postId);
      expect(response.status).toBe(200);
      return (response.body.itinerary as Summary | null)?.id ?? null;
    };

    it('shows null once the itinerary is private, and the summary again once it is public', async () => {
      await setVisibility(itineraryId, 'private');
      expect(await shown()).toBeNull();

      await setVisibility(itineraryId, 'public');
      expect(await shown()).toBe(itineraryId);
    });

    it('shows null while an admin hides it, and the summary again once shown', async () => {
      await moderate(itineraryId, 'hidden');
      expect(await shown()).toBeNull();

      await moderate(itineraryId, 'visible');
      expect(await shown()).toBe(itineraryId);
    });

    it("shows null while the itinerary's owner is deactivated (ACC-12)", async () => {
      // What ACC-12 sets on the owner's itineraries (markOwnerDeactivated).
      // ACC-12 also hides the owner's posts, so in a real deactivation the
      // page itself is 404; this checks the itinerary rule on its own.
      await fixture.itineraries.findByIdAndUpdate(itineraryId, {
        $set: { authorDeactivated: true },
      });
      try {
        expect(await shown()).toBeNull();
      } finally {
        await fixture.itineraries.findByIdAndUpdate(itineraryId, {
          $set: { authorDeactivated: false },
        });
      }
      expect(await shown()).toBe(itineraryId);
    });

    it('shows null, with no error, once the itinerary is deleted, and can still be removed', async () => {
      await http()
        .delete(`/api/itineraries/${itineraryId}`)
        .set('Cookie', author.cookie)
        .expect(204);

      expect(await shown()).toBeNull();
      const removed = await attach(postId, { itineraryId: null });
      expect(removed.status).toBe(200);
      expect(removed.body.itineraryId).toBeNull();
    });
  });

  it('removes a private itinerary with null', async () => {
    const postId = await createPost('published');
    const itinerary = await createItinerary();
    await attach(postId, { itineraryId: itinerary.id }).expect(200);
    await setVisibility(itinerary.id, 'private');

    const removed = await attach(postId, { itineraryId: null });

    expect(removed.status).toBe(200);
    expect(removed.body.itineraryId).toBeNull();
  });

  it('is documented in Swagger with its body, answer and every error status', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const document = response.body as {
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content: Record<string, { schema: { $ref: string } }>;
            };
            responses: Record<string, unknown>;
          }
        >
      >;
      components: { schemas: Record<string, { properties?: object }> };
    };
    const route = document.paths['/api/posts/{id}/itinerary'];

    expect(Object.keys(route)).toEqual(['patch']);
    expect(
      route.patch.requestBody?.content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/AttachItineraryDto');
    expect(Object.keys(route.patch.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    expect(
      document.components.schemas.PostPageResponseDto.properties,
    ).toHaveProperty('itinerary');
    expect(
      document.components.schemas.PostResponseDto.properties,
    ).toHaveProperty('itineraryId');
  });
});
