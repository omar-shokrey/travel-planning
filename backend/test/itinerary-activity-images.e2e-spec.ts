// Before anything that loads AppModule: uploads go to a throwaway folder.
import './support/uploads-env';
import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { ItinerariesService } from './../src/itineraries/itineraries.service';
import { User } from './../src/users/models/user.schema';
import { deleteAuditLogsOf } from './support/delete-audit-logs';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

const uploadsDir = process.env.UPLOADS_DIR as string;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

interface UploadFile {
  content: Buffer;
  name: string;
  type: string;
}

/** Tiny files that start like a PNG, different on every call. */
const pngFiles = (count: number): UploadFile[] =>
  Array.from({ length: count }, (_, index) => ({
    content: Buffer.concat([PNG_SIGNATURE, Buffer.from(randomUUID())]),
    name: `photo-${index}.png`,
    type: 'image/png',
  }));
const jpgFile = (): UploadFile => ({
  content: Buffer.concat([JPG_SIGNATURE, Buffer.from(randomUUID())]),
  name: 'beach.jpg',
  type: 'image/jpeg',
});
const textFile = (): UploadFile => ({
  content: Buffer.from('not an image at all'),
  name: 'notes.png',
  type: 'image/png',
});

interface ImageBody {
  filename: string;
  url: string;
}
interface ActivityBody {
  id: string;
  name: string;
  images: ImageBody[];
}
interface DetailWithActivities {
  id: string;
  days: { id: string; activities: ActivityBody[] }[];
}

/** The part of the Swagger document these tests read. */
interface SwaggerOperation {
  tags: string[];
  description: string;
  responses: Record<string, unknown>;
  requestBody?: { content: Record<string, unknown> };
}

describe('Activity images (e2e, ITN-12)', () => {
  let fixture: ItineraryFixture;
  let users: Model<User>;
  let itinerariesService: ItinerariesService;
  let owner: FixtureUser;
  let other: FixtureUser;
  let adminId: string;
  let adminCookie: string;
  let moderatorId: string;
  let moderatorCookie: string;

  const http = () => fixture.http();

  /** Files in the upload folder now. */
  const filesOnDisk = () => readdirSync(uploadsDir);
  const fileExists = (name: string) => existsSync(join(uploadsDir, name));

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role) => {
    const user = await users.create({
      name: `ITN-12 ${role}`,
      email: `itn12-${role}-${randomUUID()}@example.com`,
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
    return { id, cookie: await sessionCookieFor(fixture.app, id) };
  };

  /** A private itinerary of this user with one day and one activity on it. */
  const activityOf = async (user: FixtureUser = owner) => {
    const itinerary = await fixture.createItinerary(user, [fixture.cityA]);
    const dayId = itinerary.days[0].id;
    const added = await http()
      .post(`/api/itineraries/${itinerary.id}/days/${dayId}/activities`)
      .set('Cookie', user.cookie)
      .send({ name: 'Museum' })
      .expect(201);
    const body = added.body as DetailWithActivities;
    return {
      itineraryId: itinerary.id,
      dayId,
      activityId: body.days[0].activities[0].id,
    };
  };

  const upload = (
    activityId: string,
    cookie: string | undefined,
    files: UploadFile[],
  ) => {
    let call = http().post(`/api/activities/${activityId}/images`);
    if (cookie) {
      call = call.set('Cookie', cookie);
    }
    for (const file of files) {
      call = call.attach('images', file.content, {
        filename: file.name,
        contentType: file.type,
      });
    }
    return call;
  };

  const removeImage = (
    activityId: string,
    name: string,
    cookie: string | undefined,
  ) => {
    const call = http().delete(`/api/activities/${activityId}/images/${name}`);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /** The image names the database holds for this activity, or null if it is gone. */
  const storedImages = async (activityId: string): Promise<string[] | null> => {
    const itinerary = await fixture.itineraries
      .findOne({ 'days.activities._id': new Types.ObjectId(activityId) })
      .lean();
    for (const day of itinerary?.days ?? []) {
      for (const activity of day.activities) {
        if (activity._id.toString() === activityId) return activity.images;
      }
    }
    return null;
  };

  /** The names the response lists for this activity. */
  const namesIn = (body: DetailWithActivities, activityId: string) =>
    body.days
      .flatMap((day) => day.activities)
      .find((activity) => activity.id === activityId)
      ?.images.map((image) => image.filename) ?? [];

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    itinerariesService = fixture.app.get(ItinerariesService);
    owner = await fixture.createUser();
    other = await fixture.createUser();
    ({ id: adminId, cookie: adminCookie } = await createStaff(Role.Admin));
    ({ id: moderatorId, cookie: moderatorCookie } = await createStaff(
      Role.HotelModerator,
    ));
  });

  afterAll(async () => {
    // The audit records the admin delete wrote (GEN-07), then the staff users.
    await deleteAuditLogsOf(fixture.app, [adminId]);
    for (const id of [adminId, moderatorId]) {
      await deleteSessionsOf(fixture.app, id);
      await users.findByIdAndDelete(id);
    }
    await fixture.cleanup();
    // The files this test uploaded, one by one, then the empty folder.
    for (const file of readdirSync(uploadsDir)) {
      unlinkSync(join(uploadsDir, file));
    }
    rmdirSync(uploadsDir);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/activities/:id/images', () => {
    it('adds the images and lists them with the URL they are served at', async () => {
      const { activityId } = await activityOf();

      const response = await upload(activityId, owner.cookie, [
        ...pngFiles(1),
        jpgFile(),
      ]);

      expect(response.status).toBe(200);
      const images = response.body.days[0].activities[0].images as ImageBody[];
      expect(images).toEqual([
        {
          filename: expect.stringMatching(/^[0-9a-f-]{36}\.png$/),
          url: `/api/uploads/${images[0].filename}`,
        },
        {
          filename: expect.stringMatching(/^[0-9a-f-]{36}\.jpg$/),
          url: `/api/uploads/${images[1].filename}`,
        },
      ]);
      expect(await storedImages(activityId)).toEqual(
        images.map((image) => image.filename),
      );
      for (const image of images) {
        expect(fileExists(image.filename)).toBe(true);
        await http().get(image.url).expect(200);
      }
    });

    it('allows 5 images and refuses the 6th with 400, storing nothing more', async () => {
      const { activityId } = await activityOf();
      await upload(activityId, owner.cookie, pngFiles(5)).expect(200);
      const before = await storedImages(activityId);
      const filesBefore = filesOnDisk().length;

      const response = await upload(activityId, owner.cookie, pngFiles(1));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe(
        'An activity can have at most 5 images. It already has 5.',
      );
      expect(await storedImages(activityId)).toEqual(before);
      expect(filesOnDisk()).toHaveLength(filesBefore);
    });

    it('two uploads at the same time never pass 5, and leave no extra file', async () => {
      const { activityId } = await activityOf();
      const filesBefore = filesOnDisk().length;

      const results = await Promise.all([
        upload(activityId, owner.cookie, pngFiles(3)),
        upload(activityId, owner.cookie, pngFiles(3)),
      ]);

      const statuses = results.map((result) => result.status).sort();
      expect(statuses).toEqual([200, 400]);
      const loser = results.find((result) => result.status === 400);
      expect(loser?.body.message).toMatch(
        /^An activity can have at most 5 images\./,
      );
      const stored = (await storedImages(activityId)) ?? [];
      expect(stored).toHaveLength(3);
      // Only the winner's files are on disk.
      expect(filesOnDisk()).toHaveLength(filesBefore + 3);
      for (const name of stored) {
        expect(fileExists(name)).toBe(true);
      }
    });

    it('refuses a file over 5 MB with 413 and leaves no file on disk', async () => {
      const { activityId } = await activityOf();
      const filesBefore = filesOnDisk().length;
      const big = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(5 * 1024 * 1024)]);

      const response = await upload(activityId, owner.cookie, [
        { content: big, name: 'big.png', type: 'image/png' },
      ]);

      expect(response.status).toBe(413);
      expect(filesOnDisk()).toHaveLength(filesBefore);
      expect(await storedImages(activityId)).toEqual([]);
    });

    it('refuses a file that is not a JPG or PNG with 415, judged by its first bytes, and leaves no file', async () => {
      const { activityId } = await activityOf();
      const filesBefore = filesOnDisk().length;

      const response = await upload(activityId, owner.cookie, [textFile()]);

      expect(response.status).toBe(415);
      expect(filesOnDisk()).toHaveLength(filesBefore);
      expect(await storedImages(activityId)).toEqual([]);
    });

    it('stores none of a batch that has one bad file', async () => {
      const { activityId } = await activityOf();
      const filesBefore = filesOnDisk().length;

      const response = await upload(activityId, owner.cookie, [
        ...pngFiles(2),
        textFile(),
      ]);

      expect(response.status).toBe(415);
      expect(filesOnDisk()).toHaveLength(filesBefore);
      expect(await storedImages(activityId)).toEqual([]);
    });

    it('answers 400 when no image is sent', async () => {
      const { activityId } = await activityOf();

      const response = await upload(activityId, owner.cookie, []);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('No image was uploaded');
    });
  });

  describe('who may add and remove images (400, 401, 403, 404)', () => {
    let activityId: string;
    let imageName: string;

    beforeAll(async () => {
      ({ activityId } = await activityOf());
      const response = await upload(activityId, owner.cookie, pngFiles(1));
      imageName = (response.body as DetailWithActivities).days[0].activities[0]
        .images[0].filename;
    });

    it.each([
      ['a guest', 401, undefined],
      ['another user', 403, 'other'],
      ['an administrator', 403, 'admin'],
      ['a moderator', 403, 'moderator'],
    ])('%s gets %p and nothing changes', async (_label, status, who) => {
      const cookie = {
        other: other.cookie,
        admin: adminCookie,
        moderator: moderatorCookie,
      }[who as 'other' | 'admin' | 'moderator'];
      const filesBefore = filesOnDisk().length;

      const added = await upload(activityId, cookie, pngFiles(1));
      const removed = await removeImage(activityId, imageName, cookie);

      expect(added.status).toBe(status);
      expect(removed.status).toBe(status);
      if (status === 401) {
        expect(added.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      }
      expect(await storedImages(activityId)).toEqual([imageName]);
      expect(fileExists(imageName)).toBe(true);
      expect(filesOnDisk()).toHaveLength(filesBefore);
    });

    it('answers 400 for an id that is not valid', async () => {
      await upload('not-an-id', owner.cookie, pngFiles(1)).expect(400);
      await removeImage('not-an-id', imageName, owner.cookie).expect(400);
    });

    it('answers 404 for an activity that does not exist, and stores no file', async () => {
      const missing = new Types.ObjectId().toString();
      const filesBefore = filesOnDisk().length;

      const added = await upload(missing, owner.cookie, pngFiles(1));
      const removed = await removeImage(missing, imageName, owner.cookie);

      expect(added.status).toBe(404);
      expect(added.body.message).toBe('Activity not found');
      expect(removed.status).toBe(404);
      expect(filesOnDisk()).toHaveLength(filesBefore);
    });
  });

  describe('DELETE /api/activities/:id/images/:imageId', () => {
    it('removes the image and deletes its file', async () => {
      const { activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(2));
      const [first, second] = namesIn(added.body, activityId);

      const response = await removeImage(activityId, first, owner.cookie);

      expect(response.status).toBe(200);
      expect(namesIn(response.body, activityId)).toEqual([second]);
      expect(await storedImages(activityId)).toEqual([second]);
      expect(fileExists(first)).toBe(false);
      expect(fileExists(second)).toBe(true);
      await http().get(`/api/uploads/${first}`).expect(404);
    });

    it('answers 404 for a name the activity does not list, and touches no file', async () => {
      const { activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(1));
      const [kept] = namesIn(added.body, activityId);
      // A real file of another activity: still not this activity's image.
      const elsewhere = await activityOf();
      const otherAdded = await upload(
        elsewhere.activityId,
        owner.cookie,
        pngFiles(1),
      );
      const [otherName] = namesIn(otherAdded.body, elsewhere.activityId);

      for (const name of [`${randomUUID()}.png`, otherName]) {
        const response = await removeImage(activityId, name, owner.cookie);
        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Activity image not found');
      }
      expect(await storedImages(activityId)).toEqual([kept]);
      expect(fileExists(kept)).toBe(true);
      expect(fileExists(otherName)).toBe(true);
    });
  });

  describe('files leave with their owner', () => {
    it('deleting the activity deletes its files (ITN-10)', async () => {
      const { activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(2));
      const names = namesIn(added.body, activityId);

      await http()
        .delete(`/api/activities/${activityId}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      for (const name of names) {
        expect(fileExists(name)).toBe(false);
      }
    });

    it('deleting the day deletes the files of its activities (ITN-07)', async () => {
      const { itineraryId, dayId, activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(2));
      const names = namesIn(added.body, activityId);

      await http()
        .delete(`/api/itineraries/${itineraryId}/days/${dayId}`)
        .set('Cookie', owner.cookie)
        .expect(200);

      for (const name of names) {
        expect(fileExists(name)).toBe(false);
      }
    });

    it('deleting the itinerary as its owner deletes the files of its activities (ITN-01)', async () => {
      const { itineraryId, activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(2));
      const names = namesIn(added.body, activityId);

      await http()
        .delete(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(204);

      for (const name of names) {
        expect(fileExists(name)).toBe(false);
      }
    });

    it('the admin delete still works and deletes the files (GEN-10)', async () => {
      const { itineraryId, activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(1));
      const [name] = namesIn(added.body, activityId);

      const view = await http()
        .get(`/api/admin/content/itinerary/${itineraryId}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(JSON.stringify(view.body)).toContain(`/api/uploads/${name}`);

      await http()
        .delete(`/api/admin/content/itinerary/${itineraryId}`)
        .set('Cookie', adminCookie)
        .expect(204);

      expect(fileExists(name)).toBe(false);
      expect(await fixture.itineraries.exists({ _id: itineraryId })).toBeNull();
    });
  });

  describe('a clone shares the files (ITN-21)', () => {
    it('keeps a shared file until the last activity listing it is gone', async () => {
      const { itineraryId, activityId } = await activityOf();
      const added = await upload(activityId, owner.cookie, pngFiles(2));
      const [shared, alsoShared] = namesIn(added.body, activityId);
      await http()
        .patch(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .send({ visibility: 'public' })
        .expect(200);

      const view = await http()
        .get(`/api/itineraries/public/${itineraryId}`)
        .expect(200);
      expect(namesIn(view.body, activityId)).toEqual([shared, alsoShared]);

      const cloned = await http()
        .post(`/api/itineraries/${itineraryId}/clone`)
        .set('Cookie', other.cookie)
        .expect(201);
      const clone = cloned.body as DetailWithActivities;
      const cloneActivity = clone.days[0].activities[0];
      expect(cloneActivity.images.map((image) => image.filename)).toEqual([
        shared,
        alsoShared,
      ]);

      // The source removes one image and is then deleted: the clone still
      // lists both, so both files stay.
      await removeImage(activityId, shared, owner.cookie).expect(200);
      await http()
        .delete(`/api/itineraries/${itineraryId}`)
        .set('Cookie', owner.cookie)
        .expect(204);
      expect(fileExists(shared)).toBe(true);
      expect(fileExists(alsoShared)).toBe(true);
      await http().get(`/api/uploads/${shared}`).expect(200);

      // The clone's owner removes one image, then deletes the clone: the last
      // listings are gone, so are the files.
      await removeImage(cloneActivity.id, shared, other.cookie).expect(200);
      expect(fileExists(shared)).toBe(false);
      await http()
        .delete(`/api/itineraries/${clone.id}`)
        .set('Cookie', other.cookie)
        .expect(204);
      expect(fileExists(alsoShared)).toBe(false);
    });
  });

  describe('a write that read the itinerary before an image changed gets 409', () => {
    /**
     * Runs `between` after the request under test has read the itinerary and
     * before it writes, so the race happens every time.
     */
    const betweenReadAndWrite = (between: () => Promise<unknown>) => {
      const read = itinerariesService.findOwnedOrThrow.bind(itinerariesService);
      jest
        .spyOn(itinerariesService, 'findOwnedOrThrow')
        .mockImplementationOnce(async (...args) => {
          const itinerary = await read(...args);
          await between();
          return itinerary;
        });
    };

    it('a day delete: 409, and the image and its file are kept (ITN-07)', async () => {
      const { itineraryId, dayId, activityId } = await activityOf();
      let added: string[] = [];
      betweenReadAndWrite(async () => {
        const response = await upload(activityId, owner.cookie, pngFiles(1));
        added = namesIn(response.body, activityId);
      });

      const response = await http()
        .delete(`/api/itineraries/${itineraryId}/days/${dayId}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(409);
      expect(added).toHaveLength(1);
      expect(await storedImages(activityId)).toEqual(added);
      expect(fileExists(added[0])).toBe(true);
    });

    it('a day move: 409, and the image is kept (ITN-08)', async () => {
      const itinerary = await fixture.createItinerary(owner, [
        fixture.cityA,
        fixture.cityB,
      ]);
      const added = await http()
        .post(
          `/api/itineraries/${itinerary.id}/days/${itinerary.days[0].id}/activities`,
        )
        .set('Cookie', owner.cookie)
        .send({ name: 'Museum' })
        .expect(201);
      const activityId = (added.body as DetailWithActivities).days[0]
        .activities[0].id;
      let names: string[] = [];
      betweenReadAndWrite(async () => {
        const uploaded = await upload(activityId, owner.cookie, pngFiles(1));
        names = namesIn(uploaded.body, activityId);
      });

      const response = await http()
        .patch(`/api/itineraries/${itinerary.id}/days/reorder`)
        .set('Cookie', owner.cookie)
        .send({ dayId: itinerary.days[0].id, position: 2 });

      expect(response.status).toBe(409);
      expect(await storedImages(activityId)).toEqual(names);
    });

    it('an activity delete: 409, and the image and its file are kept (ITN-10)', async () => {
      const { activityId } = await activityOf();
      let added: string[] = [];
      const save = itinerariesService.saveOrConflict.bind(itinerariesService);
      jest
        .spyOn(itinerariesService, 'saveOrConflict')
        .mockImplementationOnce(async (itinerary) => {
          const response = await upload(activityId, owner.cookie, pngFiles(1));
          added = namesIn(response.body, activityId);
          return save(itinerary);
        });

      const response = await http()
        .delete(`/api/activities/${activityId}`)
        .set('Cookie', owner.cookie);

      expect(response.status).toBe(409);
      expect(added).toHaveLength(1);
      expect(await storedImages(activityId)).toEqual(added);
      expect(fileExists(added[0])).toBe(true);
    });

    it('an image added at the same time as a day delete: 409 or a consistent result, no lost image, no orphan file', async () => {
      const { itineraryId, dayId, activityId } = await activityOf();
      const filesBefore = new Set(filesOnDisk());

      const [added, deleted] = await Promise.all([
        upload(activityId, owner.cookie, pngFiles(2)),
        http()
          .delete(`/api/itineraries/${itineraryId}/days/${dayId}`)
          .set('Cookie', owner.cookie),
      ]);

      expect([200, 404]).toContain(added.status);
      expect([200, 409]).toContain(deleted.status);
      const stored = await storedImages(activityId);
      const newFiles = filesOnDisk().filter((name) => !filesBefore.has(name));
      if (deleted.status === 409) {
        // The day stayed: it holds exactly the uploaded files.
        expect(added.status).toBe(200);
        expect(stored).toEqual(namesIn(added.body, activityId));
      } else {
        // The day is gone: so are its files, whichever request came first.
        expect(stored).toBeNull();
      }
      expect(newFiles.sort()).toEqual([...(stored ?? [])].sort());
    });
  });

  it('documents the ITN-12 routes in Swagger', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, SwaggerOperation>
    >;
    const addRoute = paths['/api/activities/{id}/images'].post;
    const removeRoute = paths['/api/activities/{id}/images/{imageId}'].delete;

    for (const operation of [addRoute, removeRoute]) {
      expect(operation.tags).toEqual(['Itineraries']);
      expect(operation.description).toMatch(/^ITN-12/);
    }
    expect(Object.keys(addRoute.requestBody?.content ?? {})).toEqual([
      'multipart/form-data',
    ]);
    expect(Object.keys(addRoute.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404', '413', '415'].sort(),
    );
    expect(Object.keys(removeRoute.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404'].sort(),
    );
  });
});
