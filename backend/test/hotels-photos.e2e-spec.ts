// Before anything that loads AppModule: uploads go to a throwaway folder.
import './support/uploads-env';
import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { Hotel } from './../src/hotels/models/hotel.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const uploadsDir = process.env.UPLOADS_DIR as string;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** A tiny file that starts like a PNG, different on every call. */
const png = (): Buffer =>
  Buffer.concat([PNG_SIGNATURE, Buffer.from(randomUUID())]);

/** The value of one cookie in the `Set-Cookie` lines of a response, or undefined. */
function cookieValue(
  response: { headers: Record<string, unknown> },
  name: string,
): string | undefined {
  const header = response.headers['set-cookie'];
  const lines = Array.isArray(header)
    ? header.filter((line): line is string => typeof line === 'string')
    : [];
  const line = lines.find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(';')[0];
}

interface Photo {
  filename: string;
  url: string;
}

describe('Hotel photos (e2e, HTL-01)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  const createdUserIds: string[] = [];
  let hotelId = '';
  const cookies = new Map<string, string>();

  const photosPath = () => `/api/hotels/${hotelId}/photos`;

  /** POST /photos with one or more files, as `who`. */
  const upload = (
    who: string | undefined,
    files: { content: Buffer; name: string; type: string }[],
  ) => {
    let call = request(app.getHttpServer()).post(photosPath());
    if (who) {
      call = call.set('Cookie', cookies.get(who) ?? '');
    }
    for (const file of files) {
      call = call.attach('images', file.content, {
        filename: file.name,
        contentType: file.type,
      });
    }
    return call;
  };

  const pngFiles = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      content: png(),
      name: `photo-${index}.png`,
      type: 'image/png',
    }));

  const remove = (who: string, filename: string) =>
    request(app.getHttpServer())
      .delete(`${photosPath()}/${filename}`)
      .set('Cookie', cookies.get(who) ?? '');

  const storedPhotos = async (): Promise<string[]> =>
    (await hotels.findById(hotelId).lean().orFail()).photos;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database (ACC-14, BLG-01).
    const [hotel] = await hotels.insertMany([
      {
        name: 'HTL-01 photo test hotel',
        addressLine: '1 Test Street',
        cityId: `htl01-photos-${randomUUID()}`,
        countryCode: 'XX',
        description: 'Made by the HTL-01 photo e2e test.',
        starClass: 3,
        amenities: [],
        photos: [],
      },
    ]);
    hotelId = hotel._id.toString();

    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Types.ObjectId][] = [
      ['assigned', hotel._id],
      ['otherModerator', new Types.ObjectId()],
    ];
    const inserted = await users.insertMany(
      accounts.map(([label, providerId]) => ({
        name: `HTL-01 photos ${label}`,
        email: `htl01-photos-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role: Role.HotelModerator,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
        assignment: { providerType: ProviderType.Hotel, providerId },
      })),
    );
    for (const [index, user] of inserted.entries()) {
      createdUserIds.push(user._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
      cookies.set(
        accounts[index][0],
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }
  });

  afterAll(async () => {
    await hotels.findByIdAndDelete(hotelId);
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
    }
    for (const id of createdUserIds) {
      await users.findByIdAndDelete(id);
    }
    await app.close();
    // The files this test uploaded, one by one, then the empty folder.
    for (const file of readdirSync(uploadsDir)) {
      unlinkSync(join(uploadsDir, file));
    }
    rmdirSync(uploadsDir);
  });

  describe('adding photos', () => {
    it('adds a photo to the hotel and serves it at its url', async () => {
      const original = png();

      const response = await upload('assigned', [
        { content: original, name: 'lobby.png', type: 'image/png' },
      ]);

      expect(response.status).toBe(200);
      const photos = response.body.photos as Photo[];
      expect(photos).toHaveLength(1);
      expect(photos[0]).toEqual({
        filename: expect.stringMatching(/^[0-9a-f-]{36}\.png$/),
        url: `/api/uploads/${photos[0].filename}`,
      });
      expect(await storedPhotos()).toEqual([photos[0].filename]);

      const served = await request(app.getHttpServer())
        .get(photos[0].url)
        .expect(200);
      expect(served.headers['content-type']).toContain('image/png');
      expect(original.equals(served.body as Buffer)).toBe(true);
    });

    it('refuses the 6th photo with 400 and stores nothing more', async () => {
      const before = (await storedPhotos()).length;
      await upload('assigned', pngFiles(5 - before)).expect(200);
      expect(await storedPhotos()).toHaveLength(5);
      const filesBefore = readdirSync(uploadsDir).length;

      const response = await upload('assigned', pngFiles(1));

      expect(response.status).toBe(400);
      expect(await storedPhotos()).toHaveLength(5);
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore);
    });
  });

  describe('a refused upload', () => {
    // These run while the hotel already has 5 photos, so the type and the
    // access checks must answer before the photo limit.
    it('refuses a file that is not an image with 415', async () => {
      const filesBefore = readdirSync(uploadsDir).length;
      const stored = await storedPhotos();
      // Remove one photo first, so the limit is not what refuses it.
      await remove('assigned', stored[0]).expect(200);

      const response = await upload('assigned', [
        {
          content: Buffer.from('this is not an image'),
          name: 'notes.png',
          type: 'image/png',
        },
      ]);

      expect(response.status).toBe(415);
      expect(await storedPhotos()).toHaveLength(4);
      expect(readdirSync(uploadsDir)).toHaveLength(filesBefore - 1);
    });

    it('refuses a moderator of another hotel with 403', async () => {
      const response = await upload('otherModerator', pngFiles(1));

      expect(response.status).toBe(403);
      expect(await storedPhotos()).toHaveLength(4);
    });

    it('needs a login', async () => {
      const response = await upload(undefined, pngFiles(1));

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('removing photos', () => {
    it('removes the photo from the hotel and deletes its file', async () => {
      const [filename] = await storedPhotos();
      expect(existsSync(join(uploadsDir, filename))).toBe(true);

      const response = await remove('assigned', filename);

      expect(response.status).toBe(200);
      expect(
        (response.body.photos as Photo[]).map((photo) => photo.filename),
      ).not.toContain(filename);
      expect(await storedPhotos()).not.toContain(filename);
      expect(existsSync(join(uploadsDir, filename))).toBe(false);
    });

    it('answers 404 to a second delete of the same photo', async () => {
      const [filename] = await storedPhotos();
      await remove('assigned', filename).expect(200);

      const response = await remove('assigned', filename);

      expect(response.status).toBe(404);
    });

    it('refuses a moderator of another hotel with 403 and deletes nothing', async () => {
      const [filename] = await storedPhotos();

      const response = await remove('otherModerator', filename);

      expect(response.status).toBe(403);
      expect(await storedPhotos()).toContain(filename);
      expect(existsSync(join(uploadsDir, filename))).toBe(true);
    });

    it('answers 404 to a path-traversal filename and deletes nothing', async () => {
      // A file just outside the uploads folder, which the traversal names.
      const outside = `htl01-sentinel-${randomUUID()}.png`;
      const outsidePath = join(dirname(uploadsDir), outside);
      writeFileSync(outsidePath, png());
      const photosBefore = await storedPhotos();
      const filesBefore = readdirSync(uploadsDir).length;

      try {
        const response = await remove(
          'assigned',
          encodeURIComponent(`../${outside}`),
        );

        expect(response.status).toBe(404);
        expect(existsSync(outsidePath)).toBe(true);
        expect(await storedPhotos()).toEqual(photosBefore);
        expect(readdirSync(uploadsDir)).toHaveLength(filesBefore);
      } finally {
        unlinkSync(outsidePath);
      }
    });
  });
});
