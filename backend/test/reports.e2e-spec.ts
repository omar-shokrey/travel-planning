import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import './support/auth-env';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  LOGIN_REQUIRED_MESSAGE,
} from './../src/auth/auth.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { Report } from './../src/reports/models/report.schema';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const ROUTE = '/api/reports';

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

describe('POST /api/reports (e2e, GEN-09)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let itineraries: Model<Itinerary>;
  let reports: Model<Report>;
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdItineraryIds: string[] = [];
  const createdReportIds: string[] = [];

  /** Cookies and ids of the accounts and targets below, by label. */
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const id = (label: string) => ids.get(label) ?? '';

  const report = (who: string | undefined, body: Record<string, unknown>) => {
    const call = request(app.getHttpServer()).post(ROUTE).send(body);
    return who ? call.set('Cookie', cookies.get(who) ?? '') : call;
  };

  /** Sends a report and remembers its id for the clean-up. */
  const created = async (who: string, body: Record<string, unknown>) => {
    const response = await report(who, body);
    if (response.status === 201) {
      createdReportIds.push(response.body.id as string);
    }
    return response;
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();

    users = app.get<Model<User>>(getModelToken(User.name));
    posts = app.get<Model<BlogPost>>(getModelToken(BlogPost.name));
    itineraries = app.get<Model<Itinerary>>(getModelToken(Itinerary.name));
    reports = app.get<Model<Report>>(getModelToken(Report.name));
    // Waits until the unique (reporter, target) index exists, for the race test.
    await reports.init();

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['reporter', Role.User],
      ['author', Role.User],
      ['racer', Role.User],
      // Logs in while active; a test suspends it afterwards.
      ['suspended', Role.User],
      ['moderator', Role.HotelModerator],
      ['admin', Role.Admin],
    ];
    const insertedUsers = await users.insertMany(
      accounts.map(([label, role]) => ({
        name: `GEN-09 ${label}`,
        email: `gen09-${label}-${randomUUID()}@example.com`,
        passwordHash,
        role,
        status: UserStatus.Active,
        consentAcceptedAt: new Date(),
      })),
    );
    for (const [index, user] of insertedUsers.entries()) {
      const label = accounts[index][0];
      createdUserIds.push(user._id.toString());
      ids.set(label, user._id.toString());
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
      cookies.set(
        label,
        `${ACCESS_TOKEN_COOKIE}=${cookieValue(login, ACCESS_TOKEN_COOKIE)}`,
      );
    }

    const author = new Types.ObjectId(id('author'));
    const reporter = new Types.ObjectId(id('reporter'));
    const postRows: [string, Types.ObjectId, PostStatus][] = [
      ['published', author, PostStatus.Published],
      ['draft', author, PostStatus.Draft],
      ['racePost', author, PostStatus.Published],
      ['ownPost', reporter, PostStatus.Published],
      ['ownDraft', reporter, PostStatus.Draft],
    ];
    const insertedPosts = await posts.insertMany(
      postRows.map(([label, authorId, status]) => ({
        authorId,
        title: `GEN-09 ${label}`,
        body: 'Body',
        status,
        publishedAt: status === PostStatus.Published ? new Date() : undefined,
      })),
    );
    for (const [index, post] of insertedPosts.entries()) {
      createdPostIds.push(post._id.toString());
      ids.set(postRows[index][0], post._id.toString());
    }

    const itineraryRows: [
      string,
      Types.ObjectId,
      ItineraryVisibility,
      ItineraryModeration,
      boolean,
    ][] = [
      [
        'public',
        author,
        ItineraryVisibility.Public,
        ItineraryModeration.Visible,
        false,
      ],
      [
        'private',
        author,
        ItineraryVisibility.Private,
        ItineraryModeration.Visible,
        false,
      ],
      [
        'hidden',
        author,
        ItineraryVisibility.Public,
        ItineraryModeration.Hidden,
        false,
      ],
      [
        'deactivated',
        author,
        ItineraryVisibility.Public,
        ItineraryModeration.Visible,
        true,
      ],
      [
        'ownItinerary',
        reporter,
        ItineraryVisibility.Private,
        ItineraryModeration.Visible,
        false,
      ],
      [
        'ownHidden',
        reporter,
        ItineraryVisibility.Public,
        ItineraryModeration.Hidden,
        false,
      ],
    ];
    const insertedItineraries = await itineraries.insertMany(
      itineraryRows.map(
        ([label, ownerId, visibility, moderation, authorDeactivated]) => ({
          ownerId,
          title: `GEN-09 ${label}`,
          countries: ['EG'],
          startDate: '2026-12-01',
          visibility,
          moderation,
          authorDeactivated,
        }),
      ),
    );
    for (const [index, itinerary] of insertedItineraries.entries()) {
      createdItineraryIds.push(itinerary._id.toString());
      ids.set(itineraryRows[index][0], itinerary._id.toString());
    }
  });

  afterAll(async () => {
    for (const reportId of createdReportIds) {
      await reports.findByIdAndDelete(reportId);
    }
    for (const postId of createdPostIds) {
      await posts.findByIdAndDelete(postId);
    }
    for (const itineraryId of createdItineraryIds) {
      await itineraries.findByIdAndDelete(itineraryId);
    }
    for (const userId of createdUserIds) {
      await deleteSessionsOf(app, userId);
    }
    for (const userId of createdUserIds) {
      await users.findByIdAndDelete(userId);
    }
    await app.close();
  });

  describe('a saved report', () => {
    it('reports a published post of someone else with status open', async () => {
      const response = await created('reporter', {
        targetType: 'post',
        targetId: id('published'),
        reason: '  Spam links in the body  ',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        targetType: 'post',
        targetId: id('published'),
        reason: 'Spam links in the body',
        status: 'open',
        createdAt: expect.stringMatching(/Z$/),
      });

      const stored = await reports.findById(response.body.id).lean();
      expect(stored?.reporterId.toString()).toBe(id('reporter'));
      expect(stored?.targetId.toString()).toBe(id('published'));
    });

    it('reports a public itinerary of someone else', async () => {
      const response = await created('reporter', {
        targetType: 'itinerary',
        targetId: id('public'),
        reason: 'Offensive title',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        targetType: 'itinerary',
        targetId: id('public'),
        status: 'open',
      });
      expect(response.body).not.toHaveProperty('reporterId');
    });
  });

  describe('at most once per item', () => {
    it('answers 409 when I report the same item again', async () => {
      const response = await created('reporter', {
        targetType: 'post',
        targetId: id('published'),
        reason: 'Another reason',
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('You have already reported this item');
    });

    it('lets another user report the same item', async () => {
      const response = await created('racer', {
        targetType: 'post',
        targetId: id('published'),
        reason: 'Spam',
      });

      expect(response.status).toBe(201);
    });

    it('saves one report when the same user sends two at the same moment', async () => {
      const body = {
        targetType: 'post',
        targetId: id('racePost'),
        reason: 'Spam',
      };
      const answers = await Promise.all([
        created('racer', body),
        created('racer', body),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
      const count = await reports.countDocuments({
        reporterId: new Types.ObjectId(id('racer')),
        targetId: new Types.ObjectId(id('racePost')),
      });
      expect(count).toBe(1);
    });
  });

  describe('a target I cannot see', () => {
    it.each([
      ['a missing post', 'post', () => new Types.ObjectId().toString()],
      ['a draft post', 'post', () => id('draft')],
      [
        'a missing itinerary',
        'itinerary',
        () => new Types.ObjectId().toString(),
      ],
      ['a private itinerary', 'itinerary', () => id('private')],
      ['a hidden itinerary', 'itinerary', () => id('hidden')],
      [
        'an itinerary of a deactivated author',
        'itinerary',
        () => id('deactivated'),
      ],
    ])('answers 404 for %s', async (_label, targetType, targetId) => {
      const response = await created('reporter', {
        targetType,
        targetId: targetId(),
        reason: 'Spam',
      });

      expect(response.status).toBe(404);
    });

    it('answers 404 for a post id sent as an itinerary', async () => {
      const response = await created('reporter', {
        targetType: 'itinerary',
        targetId: id('published'),
        reason: 'Spam',
      });

      expect(response.status).toBe(404);
    });
  });

  describe('own content', () => {
    it.each([
      ['post', 'ownPost'],
      ['itinerary', 'ownItinerary'],
    ])('answers 400 for my own %s', async (targetType, label) => {
      const response = await created('reporter', {
        targetType,
        targetId: id(label),
        reason: 'Testing',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('You cannot report your own content');
    });

    it('answers 400 for my own itinerary that an admin hid: I still see it', async () => {
      const response = await created('reporter', {
        targetType: 'itinerary',
        targetId: id('ownHidden'),
        reason: 'Testing',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('You cannot report your own content');
    });

    it('answers 404 for my own draft, like any draft', async () => {
      const response = await created('reporter', {
        targetType: 'post',
        targetId: id('ownDraft'),
        reason: 'Testing',
      });

      expect(response.status).toBe(404);
    });
  });

  describe('invalid input', () => {
    const valid = () => ({
      targetType: 'post',
      targetId: id('published'),
      reason: 'Spam',
    });

    it.each([
      ['targetType', null],
      ['targetType', 'comment'],
      ['targetType', undefined],
      ['targetId', null],
      ['targetId', 'abc'],
      ['reason', null],
      ['reason', '   '],
      ['reason', 'a'.repeat(501)],
      ['reason', undefined],
    ])('answers 400 for %s = %p', async (field, value) => {
      const response = await created('author', {
        ...valid(),
        [field]: value,
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });

    it.each(['reporterId', 'status'])(
      'answers 400 for the server-set field %s',
      async (field) => {
        const response = await created('author', {
          ...valid(),
          [field]: field === 'status' ? 'dismissed' : id('author'),
        });

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual([
          expect.objectContaining({ field }),
        ]);
      },
    );
  });

  describe('who may report', () => {
    it.each(['moderator', 'admin'])('answers 403 for a %s', async (who) => {
      const response = await created(who, {
        targetType: 'post',
        targetId: id('published'),
        reason: 'Spam',
      });

      expect(response.status).toBe(403);
    });

    it('answers 401 without a login', async () => {
      const response = await report(undefined, {
        targetType: 'post',
        targetId: id('published'),
        reason: 'Spam',
      });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });

    it('answers 403 for a suspended user, and saves nothing', async () => {
      // findByIdAndUpdate: updateOne in tests has stalled against the Atlas
      // test database.
      await users.findByIdAndUpdate(id('suspended'), {
        status: UserStatus.Suspended,
      });

      const response = await created('suspended', {
        targetType: 'post',
        targetId: id('published'),
        reason: 'Spam',
      });

      expect(response.status).toBe(403);
      expect(response.body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
      const saved = await reports.countDocuments({
        reporterId: new Types.ObjectId(id('suspended')),
      });
      expect(saved).toBe(0);
    });
  });

  describe('Swagger', () => {
    it('documents the route, its body and its answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);

      const route = response.body.paths[ROUTE].post;
      expect(Object.keys(route.responses)).toEqual(
        expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
      );
      const schema = response.body.components.schemas.CreateReportDto;
      expect(schema.required).toEqual(
        expect.arrayContaining(['targetType', 'targetId', 'reason']),
      );
      expect(schema.properties.targetType.enum).toEqual(['post', 'itinerary']);
      expect(
        response.body.components.schemas.ReportResponseDto.properties,
      ).not.toHaveProperty('reporterId');
    });
  });
});
