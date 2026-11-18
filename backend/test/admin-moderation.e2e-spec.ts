import './support/uploads-env';
import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { hash } from 'bcrypt';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { Comment } from './../src/blog/models/comment.schema';
import { Like } from './../src/blog/models/like.schema';
import { PostModeration } from './../src/blog/models/post-moderation.enum';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { ACCESS_TOKEN_COOKIE } from './../src/common/constants/cookies';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { ItineraryModeration } from './../src/itineraries/enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './../src/itineraries/enums/itinerary-visibility.enum';
import { Itinerary } from './../src/itineraries/models/itinerary.schema';
import { ReportStatus } from './../src/reports/enums/report-status.enum';
import { ReportTargetType } from './../src/reports/enums/report-target-type.enum';
import { Report } from './../src/reports/models/report.schema';
import { User } from './../src/users/models/user.schema';
import { deleteAuditLogsOf } from './support/delete-audit-logs';
import { deleteSessionsOf } from './support/delete-sessions';

const PASSWORD = 'Passw0rdOK';
const REPORTS = '/api/admin/reports';
const uploadsDir = process.env.UPLOADS_DIR as string;

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

/** A stored image file name, the shape UploadsService gives. */
const imageName = (extension: 'jpg' | 'png' = 'jpg') =>
  `${randomUUID()}.${extension}`;

type Row = { id: string; status: string; targetType: string };

describe('Admin report handling and moderation (e2e, GEN-10)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let itineraries: Model<Itinerary>;
  let reports: Model<Report>;
  let comments: Model<Comment>;
  let likes: Model<Like>;
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdItineraryIds: string[] = [];
  const createdReportIds: string[] = [];

  /** Cookies and ids of the accounts, content and reports below, by label. */
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const id = (label: string) => ids.get(label) ?? '';

  // Image files of the content that is deleted, and one a clone still uses.
  const deletedPostImages = [imageName(), imageName('png')];
  const deletedItineraryImage = imageName();
  const sharedCloneImage = imageName();

  const call = (
    who: string | undefined,
    method: 'get' | 'patch' | 'delete' | 'post',
    url: string,
  ) => {
    const req = request(app.getHttpServer())[method](url);
    return who ? req.set('Cookie', cookies.get(who) ?? '') : req;
  };
  const resolve = (reportLabel: string, body: Record<string, unknown>) =>
    call('admin', 'patch', `${REPORTS}/${id(reportLabel)}`).send(body);
  const moderate = (type: string, targetId: string, body: unknown) =>
    call('admin', 'patch', `/api/admin/content/${type}/${targetId}`).send(
      body as object,
    );
  const remove = (type: string, targetId: string) =>
    call('admin', 'delete', `/api/admin/content/${type}/${targetId}`);
  const storedReport = (label: string) =>
    reports.findById(id(label)).lean().exec();
  /** A report by a user, through GEN-09, to check what that user can see. */
  const reportAs = (who: string, targetType: string, targetId: string) =>
    call(who, 'post', '/api/reports').send({
      targetType,
      targetId,
      reason: 'Checking visibility',
    });

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
    comments = app.get<Model<Comment>>(getModelToken(Comment.name));
    likes = app.get<Model<Like>>(getModelToken(Like.name));

    mkdirSync(uploadsDir, { recursive: true });
    for (const name of [
      ...deletedPostImages,
      deletedItineraryImage,
      sharedCloneImage,
    ]) {
      writeFileSync(join(uploadsDir, name), Buffer.from('image'));
    }

    // One insertMany per collection: single creates in a row have stalled
    // against the Atlas test database.
    const passwordHash = await hash(PASSWORD, 4);
    const accounts: [string, Role][] = [
      ['admin', Role.Admin],
      ['author', Role.User],
      ['reporter1', Role.User],
      ['reporter2', Role.User],
      ['viewer', Role.User],
      ['moderator', Role.AirlineModerator],
    ];
    const insertedUsers = await users.insertMany(
      accounts.map(([label, role]) => ({
        name: `GEN-10 ${label}`,
        email: `gen10-${label}-${randomUUID()}@example.com`,
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
    const postLabels = [
      'pDismiss',
      'pHide',
      'pDelete',
      'pRace',
      'pDirect',
      'pDirectDelete',
      // BLG-05/06 with GEN-10: hidden, then deleted with its comments and likes.
      'pEngageHide',
      'pEngageDelete',
      // Comments reported (GEN-09) and moderated (GEN-10).
      'pComments',
      'pCommentsHiddenPost',
    ];
    const insertedPosts = await posts.insertMany(
      postLabels.map((label) => ({
        authorId: author,
        title: `GEN-10 ${label}`,
        body: 'Body',
        status: PostStatus.Published,
        publishedAt: new Date(),
        images: label === 'pDelete' ? deletedPostImages : [],
      })),
    );
    for (const [index, post] of insertedPosts.entries()) {
      createdPostIds.push(post._id.toString());
      ids.set(postLabels[index], post._id.toString());
    }

    const day = (images: string[]) => ({
      cityId: 'cairo',
      activities: [{ name: 'Museum', images }],
    });
    const itineraryRows: [string, Types.ObjectId, ReturnType<typeof day>[]][] =
      [
        ['iHide', author, []],
        ['iDelete', author, [day([deletedItineraryImage, sharedCloneImage])]],
        // A clone of another user that kept one image name (ITN-21).
        ['iClone', new Types.ObjectId(id('viewer')), [day([sharedCloneImage])]],
        ['iDirect', author, []],
      ];
    const insertedItineraries = await itineraries.insertMany(
      itineraryRows.map(([label, ownerId, days]) => ({
        ownerId,
        title: `GEN-10 ${label}`,
        countries: ['EG'],
        startDate: '2026-12-01',
        visibility: ItineraryVisibility.Public,
        moderation: ItineraryModeration.Visible,
        days,
        dayCount: days.length,
      })),
    );
    for (const [index, itinerary] of insertedItineraries.entries()) {
      createdItineraryIds.push(itinerary._id.toString());
      ids.set(itineraryRows[index][0], itinerary._id.toString());
    }

    // Reports dated in 2001, so they come before any other report in the
    // shared test database (the list is oldest first), in this order.
    const missingPost = new Types.ObjectId();
    const missingPost2 = new Types.ObjectId();
    const reportRows: [string, string, ReportTargetType, string][] = [
      ['rDismiss', 'reporter1', ReportTargetType.Post, id('pDismiss')],
      ['rDismissOther', 'reporter2', ReportTargetType.Post, id('pDismiss')],
      ['rHide', 'reporter1', ReportTargetType.Post, id('pHide')],
      ['rHideOther', 'reporter2', ReportTargetType.Post, id('pHide')],
      ['rDelete', 'reporter1', ReportTargetType.Post, id('pDelete')],
      ['rDeleteOther', 'reporter2', ReportTargetType.Post, id('pDelete')],
      ['rRace', 'reporter1', ReportTargetType.Post, id('pRace')],
      ['rGoneHide', 'reporter1', ReportTargetType.Post, missingPost.toString()],
      [
        'rGoneDelete',
        'reporter1',
        ReportTargetType.Post,
        missingPost2.toString(),
      ],
      ['rItHide', 'reporter1', ReportTargetType.Itinerary, id('iHide')],
      ['rItDelete', 'reporter1', ReportTargetType.Itinerary, id('iDelete')],
      ['rDirect', 'reporter1', ReportTargetType.Post, id('pDirect')],
      ['rItDirect', 'reporter1', ReportTargetType.Itinerary, id('iDirect')],
    ];
    const insertedReports = await reports.insertMany(
      reportRows.map(([, reporter, targetType, targetId], index) => ({
        reporterId: new Types.ObjectId(id(reporter)),
        targetType,
        targetId: new Types.ObjectId(targetId),
        reason: 'Spam',
        status: ReportStatus.Open,
        createdAt: new Date(Date.UTC(2001, 0, 1, 0, 0, index)),
      })),
    );
    for (const [index, report] of insertedReports.entries()) {
      createdReportIds.push(report._id.toString());
      ids.set(reportRows[index][0], report._id.toString());
    }
  });

  afterAll(async () => {
    // Comments and likes made on the test posts (BLG-05/06), one by one by id.
    for (const postId of createdPostIds) {
      const filter = { postId: new Types.ObjectId(postId) };
      for (const { _id } of await comments.find(filter).select('_id').lean()) {
        await comments.findByIdAndDelete(_id);
      }
      for (const { _id } of await likes.find(filter).select('_id').lean()) {
        await likes.findByIdAndDelete(_id);
      }
    }
    // Includes the reports of other users made through GEN-09 below.
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
    // The audit records (GEN-07) the admin's actions wrote, by admin id.
    await deleteAuditLogsOf(app, createdUserIds);
    for (const userId of createdUserIds) {
      await users.findByIdAndDelete(userId);
    }
    await app.close();
  });

  describe('GET /api/admin/reports', () => {
    const mine = (rows: Row[]) =>
      rows.filter((row) => createdReportIds.includes(row.id));

    it('lists the open reports by default, oldest first, with the reporter', async () => {
      const response = await call('admin', 'get', `${REPORTS}?limit=50`);

      expect(response.status).toBe(200);
      const rows = mine(response.body.items as Row[]);
      expect(rows.map((row) => row.id)).toEqual(createdReportIds);
      expect(rows.every((row) => row.status === 'open')).toBe(true);
      expect(response.body.items[0]).toEqual({
        id: id('rDismiss'),
        targetType: 'post',
        targetId: id('pDismiss'),
        reason: 'Spam',
        status: 'open',
        createdAt: '2001-01-01T00:00:00.000Z',
        reporterId: id('reporter1'),
      });
    });

    it('filters by target type', async () => {
      const response = await call(
        'admin',
        'get',
        `${REPORTS}?targetType=itinerary&limit=50`,
      );

      expect(response.status).toBe(200);
      const items = response.body.items as Row[];
      expect(items.every((row) => row.targetType === 'itinerary')).toBe(true);
      expect(mine(items).map((row) => row.id)).toEqual([
        id('rItHide'),
        id('rItDelete'),
        id('rItDirect'),
      ]);
    });

    it('pages through the reports (GEN-05)', async () => {
      // Compared with the whole list, so open reports that other suites or an
      // interrupted run left in the shared test database cannot change it.
      const all: Row[] = [];
      let page = 1;
      let items: Row[];
      do {
        const response = await call(
          'admin',
          'get',
          `${REPORTS}?page=${page}&limit=50`,
        );
        expect(response.status).toBe(200);
        items = response.body.items as Row[];
        all.push(...items);
        page += 1;
      } while (items.length === 50);

      const first = await call('admin', 'get', `${REPORTS}?page=1&limit=2`);
      const second = await call('admin', 'get', `${REPORTS}?page=2&limit=2`);

      const idsOf = (rows: Row[]) => rows.map((row) => row.id);
      expect(idsOf(first.body.items)).toEqual(idsOf(all.slice(0, 2)));
      expect(idsOf(second.body.items)).toEqual(idsOf(all.slice(2, 4)));
      // This suite's four oldest reports come in this order (oldest first).
      const positions = [
        'rDismiss',
        'rDismissOther',
        'rHide',
        'rHideOther',
      ].map((label) => all.findIndex((row) => row.id === id(label)));
      expect(positions).not.toContain(-1);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(second.body.meta).toMatchObject({ page: 2, limit: 2 });
      expect(second.body.meta.total).toBeGreaterThanOrEqual(
        createdReportIds.length,
      );
    });

    it.each([
      ['status=closed', 'status'],
      ['targetType=review', 'targetType'],
      ['limit=51', 'limit'],
      ['reporterId=x', 'reporterId'],
    ])('answers 400 for %s', async (query, field) => {
      const response = await call('admin', 'get', `${REPORTS}?${query}`);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });

    it.each(['author', 'moderator'])('answers 403 for a %s', async (who) => {
      expect((await call(who, 'get', REPORTS)).status).toBe(403);
    });

    it('answers 401 without a login', async () => {
      const response = await call(undefined, 'get', REPORTS);

      expect(response.status).toBe(401);
      expect(response.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
    });
  });

  describe('PATCH /api/admin/reports/:id', () => {
    it('dismisses one report and leaves the post and the other report as they are', async () => {
      const response = await resolve('rDismiss', { action: 'dismiss' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: id('rDismiss'),
        status: 'dismissed',
        resolvedBy: id('admin'),
        resolvedAt: expect.stringMatching(/Z$/),
        reporterId: id('reporter1'),
      });
      expect((await storedReport('rDismissOther'))?.status).toBe('open');
      const post = await posts.findById(id('pDismiss')).lean().exec();
      expect(post?.moderation).toBe(PostModeration.Visible);

      const dismissed = await call(
        'admin',
        'get',
        `${REPORTS}?status=dismissed&limit=50`,
      );
      expect((dismissed.body.items as Row[]).map((row) => row.id)).toContain(
        id('rDismiss'),
      );
    });

    it('answers 409 for a report that is already resolved', async () => {
      const response = await resolve('rDismiss', { action: 'hide' });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe(
        'This report has already been resolved',
      );
    });

    it('hides the post and resolves its other open report as hidden', async () => {
      const response = await resolve('rHide', { action: 'hide' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('hidden');
      const post = await posts.findById(id('pHide')).lean().exec();
      expect(post?.moderation).toBe(PostModeration.Hidden);
      const other = await storedReport('rHideOther');
      expect(other?.status).toBe('hidden');
      expect(other?.resolvedBy?.toString()).toBe(id('admin'));
    });

    it('hides the post from other users: it can no longer be reported (GEN-09)', async () => {
      const response = await reportAs('viewer', 'post', id('pHide'));

      expect(response.status).toBe(404);
    });

    it('still shows the hidden post to its author in "my posts", marked hidden (BLG-03)', async () => {
      const response = await call('author', 'get', '/api/posts/mine?limit=50');

      expect(response.status).toBe(200);
      const row = (
        response.body.items as { id: string; moderation: string }[]
      ).find((item) => item.id === id('pHide'));
      expect(row?.moderation).toBe('hidden');
    });

    it('deletes the post with its image files and resolves its other report as deleted', async () => {
      const response = await resolve('rDelete', { action: 'delete' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('deleted');
      expect(await posts.countDocuments({ _id: id('pDelete') })).toBe(0);
      for (const name of deletedPostImages) {
        expect(existsSync(join(uploadsDir, name))).toBe(false);
      }
      expect((await storedReport('rDeleteOther'))?.status).toBe('deleted');
      // Reports of deleted content stay, for history.
      expect(await storedReport('rDelete')).not.toBeNull();
    });

    it('lets only one of two admins at the same moment resolve a report', async () => {
      const answers = await Promise.all([
        resolve('rRace', { action: 'hide' }),
        resolve('rRace', { action: 'dismiss' }),
      ]);

      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const winner = answers.find((answer) => answer.status === 200);
      const post = await posts.findById(id('pRace')).lean().exec();
      // The content matches the action that won, never the one that lost.
      expect(post?.moderation).toBe(
        winner?.body.status === 'hidden'
          ? PostModeration.Hidden
          : PostModeration.Visible,
      );
      expect((await storedReport('rRace'))?.status).toBe(winner?.body.status);
    });

    it('answers 409 and keeps the report open when the content to hide no longer exists', async () => {
      const response = await resolve('rGoneHide', { action: 'hide' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('no longer exists');
      expect((await storedReport('rGoneHide'))?.status).toBe('open');
    });

    it('closes the report when the content to delete no longer exists', async () => {
      const response = await resolve('rGoneDelete', { action: 'delete' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('deleted');
    });

    it('hides an itinerary: other users no longer see it, its owner still does', async () => {
      const response = await resolve('rItHide', { action: 'hide' });

      expect(response.status).toBe(200);
      const itinerary = await itineraries.findById(id('iHide')).lean().exec();
      expect(itinerary?.moderation).toBe(ItineraryModeration.Hidden);
      expect((await reportAs('viewer', 'itinerary', id('iHide'))).status).toBe(
        404,
      );
      expect(
        (await call('author', 'get', `/api/itineraries/${id('iHide')}`)).status,
      ).toBe(200);
    });

    it('deletes an itinerary and its images, but keeps an image a clone still uses', async () => {
      const response = await resolve('rItDelete', { action: 'delete' });

      expect(response.status).toBe(200);
      expect(
        (await call('author', 'get', `/api/itineraries/${id('iDelete')}`))
          .status,
      ).toBe(404);
      expect(existsSync(join(uploadsDir, deletedItineraryImage))).toBe(false);
      expect(existsSync(join(uploadsDir, sharedCloneImage))).toBe(true);
      expect(await itineraries.countDocuments({ _id: id('iClone') })).toBe(1);
    });

    it('answers 404 for an unknown report', async () => {
      const response = await call(
        'admin',
        'patch',
        `${REPORTS}/${new Types.ObjectId().toString()}`,
      ).send({ action: 'dismiss' });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Report not found');
    });

    it.each([
      ['no action', {}],
      ['a null action', { action: null }],
      ['an unknown action', { action: 'approve' }],
    ])('answers 400 for %s', async (_label, body) => {
      const response = await resolve('rDirect', body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field: 'action' }),
      ]);
    });

    it('answers 400 for a field the server sets', async () => {
      const response = await resolve('rDirect', {
        action: 'dismiss',
        resolvedBy: id('author'),
      });

      expect(response.status).toBe(400);
      expect((await storedReport('rDirect'))?.status).toBe('open');
    });

    it('answers 400 for an id that is not an id', async () => {
      const response = await call('admin', 'patch', `${REPORTS}/abc`).send({
        action: 'dismiss',
      });

      expect(response.status).toBe(400);
    });

    it.each(['author', 'moderator'])('answers 403 for a %s', async (who) => {
      const response = await call(
        who,
        'patch',
        `${REPORTS}/${id('rDirect')}`,
      ).send({ action: 'dismiss' });

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH and DELETE /api/admin/content/:type/:id', () => {
    it('hides a post directly and resolves its open report as hidden', async () => {
      const before = await posts.findById(id('pDirect')).lean().exec();

      const response = await moderate('post', id('pDirect'), {
        moderation: 'hidden',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        type: 'post',
        id: id('pDirect'),
        moderation: 'hidden',
      });
      // Hiding is not an edit by the author: "last changed" stays.
      const after = await posts.findById(id('pDirect')).lean().exec();
      expect(after?.updatedAt.toISOString()).toBe(
        before?.updatedAt.toISOString(),
      );
      expect((await storedReport('rDirect'))?.status).toBe('hidden');
      expect((await reportAs('viewer', 'post', id('pDirect'))).status).toBe(
        404,
      );
    });

    it('answers 409 when the post is already hidden', async () => {
      const response = await moderate('post', id('pDirect'), {
        moderation: 'hidden',
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('The post is already hidden');
    });

    it('shows the post again, and other users can see (report) it again', async () => {
      const response = await moderate('post', id('pDirect'), {
        moderation: 'visible',
      });

      expect(response.status).toBe(200);
      expect(response.body.moderation).toBe('visible');
      const report = await reportAs('viewer', 'post', id('pDirect'));
      expect(report.status).toBe(201);
      createdReportIds.push(report.body.id as string);
      // A resolved report stays resolved.
      expect((await storedReport('rDirect'))?.status).toBe('hidden');
    });

    it('answers 409 when the post is already visible', async () => {
      const response = await moderate('post', id('pDirect'), {
        moderation: 'visible',
      });

      expect(response.status).toBe(409);
    });

    it('hides and shows an itinerary directly', async () => {
      const hidden = await moderate('itinerary', id('iDirect'), {
        moderation: 'hidden',
      });
      expect(hidden.status).toBe(200);
      expect((await storedReport('rItDirect'))?.status).toBe('hidden');
      expect(
        (await reportAs('viewer', 'itinerary', id('iDirect'))).status,
      ).toBe(404);

      const again = await moderate('itinerary', id('iDirect'), {
        moderation: 'hidden',
      });
      expect(again.status).toBe(409);

      const visible = await moderate('itinerary', id('iDirect'), {
        moderation: 'visible',
      });
      expect(visible.status).toBe(200);
      const itinerary = await itineraries.findById(id('iDirect')).lean().exec();
      expect(itinerary?.moderation).toBe(ItineraryModeration.Visible);
    });

    it.each(['post', 'itinerary'])(
      'answers 404 for a %s that does not exist',
      async (type) => {
        const missing = new Types.ObjectId().toString();

        expect(
          (await moderate(type, missing, { moderation: 'hidden' })).status,
        ).toBe(404);
        expect((await remove(type, missing)).status).toBe(404);
      },
    );

    it('deletes a post directly (204), then answers 404', async () => {
      const first = await remove('post', id('pDirectDelete'));
      expect(first.status).toBe(204);
      expect(await posts.countDocuments({ _id: id('pDirectDelete') })).toBe(0);

      expect((await remove('post', id('pDirectDelete'))).status).toBe(404);
    });

    it('deletes an itinerary directly and resolves its open report as deleted', async () => {
      // A fresh open report of the itinerary, through GEN-09.
      const report = await reportAs('viewer', 'itinerary', id('iDirect'));
      expect(report.status).toBe(201);
      createdReportIds.push(report.body.id as string);

      expect((await remove('itinerary', id('iDirect'))).status).toBe(204);
      expect(await itineraries.countDocuments({ _id: id('iDirect') })).toBe(0);
      const stored = await reports.findById(report.body.id).lean().exec();
      expect(stored?.status).toBe('deleted');
    });

    it.each([
      ['a null moderation', { moderation: null }, 'moderation'],
      ['no moderation', {}, 'moderation'],
      ['an unknown moderation', { moderation: 'deleted' }, 'moderation'],
      ['a field that is not allowed', { moderation: 'hidden', x: 1 }, 'x'],
    ])('answers 400 for %s', async (_label, body, field) => {
      const response = await moderate('post', id('pDismiss'), body);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field }),
      ]);
    });

    it('answers 400 for an unknown content type or a bad id', async () => {
      const badType = await moderate('review', id('pDismiss'), {
        moderation: 'hidden',
      });
      expect(badType.status).toBe(400);
      expect(badType.body.message).toBe(
        'type must be one of: post, itinerary, comment',
      );

      expect((await remove('post', 'abc')).status).toBe(400);
    });

    it.each(['author', 'moderator'])('answers 403 for a %s', async (who) => {
      const patch = await call(
        who,
        'patch',
        `/api/admin/content/post/${id('pDismiss')}`,
      ).send({ moderation: 'hidden' });
      const del = await call(
        who,
        'delete',
        `/api/admin/content/post/${id('pDismiss')}`,
      );

      expect(patch.status).toBe(403);
      expect(del.status).toBe(403);
    });

    it('answers 401 without a login', async () => {
      expect(
        (
          await call(
            undefined,
            'delete',
            `/api/admin/content/post/${id('pDismiss')}`,
          )
        ).status,
      ).toBe(401);
    });
  });

  describe('comments and likes of hidden and deleted posts (BLG-05, BLG-06)', () => {
    const comment = (who: string | undefined, postId: string) =>
      call(who, 'post', `/api/posts/${postId}/comments`).send({
        body: 'Nice trip',
      });
    const like = (who: string, postId: string) =>
      call(who, 'post', `/api/posts/${postId}/like`);

    it('a hidden post answers 404 to comments, the comment list and likes, except for its author', async () => {
      const postId = id('pEngageHide');
      expect((await comment('viewer', postId)).status).toBe(201);
      expect((await like('viewer', postId)).status).toBe(201);

      expect(
        (await moderate('post', postId, { moderation: 'hidden' })).status,
      ).toBe(200);

      expect((await comment('viewer', postId)).status).toBe(404);
      expect(
        (await call(undefined, 'get', `/api/posts/${postId}/comments`)).status,
      ).toBe(404);
      expect(
        (await call('viewer', 'get', `/api/posts/${postId}/comments`)).status,
      ).toBe(404);
      expect((await like('reporter1', postId)).status).toBe(404);
      expect(
        (await call('viewer', 'delete', `/api/posts/${postId}/like`)).status,
      ).toBe(404);
      // Its author still reaches their own hidden post.
      expect((await comment('author', postId)).status).toBe(201);
    });

    it('deleting a post as admin also deletes its comments and likes', async () => {
      const postId = id('pEngageDelete');
      expect((await comment('viewer', postId)).status).toBe(201);
      expect((await comment('reporter1', postId)).status).toBe(201);
      expect((await like('viewer', postId)).status).toBe(201);
      const filter = { postId: new Types.ObjectId(postId) };
      expect(await comments.countDocuments(filter)).toBe(2);
      expect(await likes.countDocuments(filter)).toBe(1);

      expect((await remove('post', postId)).status).toBe(204);

      expect(await comments.countDocuments(filter)).toBe(0);
      expect(await likes.countDocuments(filter)).toBe(0);
    });
  });

  describe('comments: reported (GEN-09) and moderated (GEN-10)', () => {
    const commentOn = async (who: string, postId: string, body: string) => {
      const response = await call(
        who,
        'post',
        `/api/posts/${postId}/comments`,
      ).send({ body });
      expect(response.status).toBe(201);
      return response.body.id as string;
    };
    const listedIds = async (postId: string) => {
      const response = await call(
        undefined,
        'get',
        `/api/posts/${postId}/comments?limit=50`,
      );
      expect(response.status).toBe(200);
      return (response.body.items as { id: string }[]).map((item) => item.id);
    };
    const commentCount = async (postId: string) =>
      (await posts.findById(postId).select('commentCount').lean().exec())
        ?.commentCount;
    /** A report through GEN-09; a 201 is kept for the cleanup. */
    const report = async (who: string | undefined, commentId: string) => {
      const response = await call(who, 'post', '/api/reports').send({
        targetType: 'comment',
        targetId: commentId,
        reason: 'Rude comment',
      });
      if (response.status === 201) {
        createdReportIds.push(response.body.id as string);
      }
      return response;
    };

    beforeAll(async () => {
      ids.set('cHide', await commentOn('viewer', id('pComments'), 'Hide me'));
      ids.set('cDelete', await commentOn('viewer', id('pComments'), 'Bye'));
      ids.set(
        'cDeleteHidden',
        await commentOn('viewer', id('pComments'), 'Hidden, then deleted'),
      );
      ids.set(
        'cOnHiddenPost',
        await commentOn('viewer', id('pCommentsHiddenPost'), 'On a post'),
      );
    });

    it('a user reports a comment of someone else: 201, open (GEN-09)', async () => {
      const response = await report('reporter1', id('cHide'));

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        targetType: 'comment',
        targetId: id('cHide'),
        status: 'open',
      });
      ids.set('rComment', response.body.id as string);
    });

    it('refuses my own comment with 400', async () => {
      const response = await report('viewer', id('cHide'));

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('You cannot report your own content');
    });

    it('answers 404 for a comment that does not exist', async () => {
      const response = await report(
        'reporter1',
        new Types.ObjectId().toString(),
      );

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Comment not found');
    });

    it('answers 401 to a guest', async () => {
      expect((await report(undefined, id('cHide'))).status).toBe(401);
    });

    it('answers 404 for a comment on a hidden post, except to the post author', async () => {
      expect(
        (
          await moderate('post', id('pCommentsHiddenPost'), {
            moderation: 'hidden',
          })
        ).status,
      ).toBe(200);

      expect((await report('reporter1', id('cOnHiddenPost'))).status).toBe(404);
      // The author of the post still sees it, so the comment can be reported.
      expect((await report('author', id('cOnHiddenPost'))).status).toBe(201);
    });

    it('a non-admin gets 403 on the comment routes', async () => {
      const url = `/api/admin/content/comment/${id('cHide')}`;
      expect(
        (await call('viewer', 'patch', url).send({ moderation: 'hidden' }))
          .status,
      ).toBe(403);
      expect((await call('moderator', 'delete', url)).status).toBe(403);
    });

    it('hiding a comment takes it off the list and the count, and resolves its open reports as hidden', async () => {
      const postId = id('pComments');
      expect(await commentCount(postId)).toBe(3);

      const response = await moderate('comment', id('cHide'), {
        moderation: 'hidden',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        type: 'comment',
        id: id('cHide'),
        moderation: 'hidden',
      });
      expect(await listedIds(postId)).not.toContain(id('cHide'));
      expect(await commentCount(postId)).toBe(2);
      expect((await storedReport('rComment'))?.status).toBe(
        ReportStatus.Hidden,
      );
      // Others no longer see it; its author still edits it (BLG-07).
      expect((await report('reporter2', id('cHide'))).status).toBe(404);
      const edit = await call(
        'viewer',
        'patch',
        `/api/comments/${id('cHide')}`,
      ).send({ body: 'Edited while hidden' });
      expect(edit.status).toBe(200);
      expect(edit.body.moderation).toBe('hidden');
    });

    it('a second hide answers 409 and does not count twice', async () => {
      const response = await moderate('comment', id('cHide'), {
        moderation: 'hidden',
      });

      expect(response.status).toBe(409);
      expect(response.body.message).toBe('The comment is already hidden');
      expect(await commentCount(id('pComments'))).toBe(2);
    });

    it('an admin still sees hidden content; others get 403, missing content 404', async () => {
      const view = (who: string, type: string, targetId: string) =>
        call(who, 'get', `/api/admin/content/${type}/${targetId}`);

      const comment = await view('admin', 'comment', id('cHide'));
      expect(comment.status).toBe(200);
      expect(comment.body).toMatchObject({
        type: 'comment',
        id: id('cHide'),
        moderation: 'hidden',
        comment: { id: id('cHide'), body: 'Edited while hidden' },
      });

      const post = await view('admin', 'post', id('pCommentsHiddenPost'));
      expect(post.status).toBe(200);
      expect(post.body).toMatchObject({
        type: 'post',
        moderation: 'hidden',
        post: { id: id('pCommentsHiddenPost') },
      });

      // Hidden above through its report (rItHide).
      const itinerary = await view('admin', 'itinerary', id('iHide'));
      expect(itinerary.status).toBe(200);
      expect(itinerary.body).toMatchObject({
        type: 'itinerary',
        moderation: 'hidden',
        itinerary: { id: id('iHide'), days: expect.any(Array) },
      });

      expect((await view('viewer', 'comment', id('cHide'))).status).toBe(403);
      const missing = await view(
        'admin',
        'comment',
        new Types.ObjectId().toString(),
      );
      expect(missing.status).toBe(404);
      expect(missing.body.message).toBe('Comment not found');
    });

    it('showing it again puts it back on the list and raises the count', async () => {
      const response = await moderate('comment', id('cHide'), {
        moderation: 'visible',
      });

      expect(response.status).toBe(200);
      expect(await listedIds(id('pComments'))).toContain(id('cHide'));
      expect(await commentCount(id('pComments'))).toBe(3);
    });

    it('deleting a visible comment removes it and lowers the count', async () => {
      const response = await remove('comment', id('cDelete'));

      expect(response.status).toBe(204);
      expect(await comments.findById(id('cDelete')).lean().exec()).toBeNull();
      expect(await listedIds(id('pComments'))).not.toContain(id('cDelete'));
      expect(await commentCount(id('pComments'))).toBe(2);
      expect((await remove('comment', id('cDelete'))).status).toBe(404);
    });

    it('deleting a hidden comment leaves the count: it was taken off when hidden', async () => {
      expect(
        (
          await moderate('comment', id('cDeleteHidden'), {
            moderation: 'hidden',
          })
        ).status,
      ).toBe(200);
      expect(await commentCount(id('pComments'))).toBe(1);

      expect((await remove('comment', id('cDeleteHidden'))).status).toBe(204);
      expect(await commentCount(id('pComments'))).toBe(1);
    });

    it('answers 404 for a comment that does not exist', async () => {
      const missing = new Types.ObjectId().toString();
      const response = await moderate('comment', missing, {
        moderation: 'hidden',
      });

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Comment not found');
    });

    it('audits every comment action with the target type comment (GEN-07)', async () => {
      const response = await call(
        'admin',
        'get',
        `/api/admin/audit-logs?adminId=${id('admin')}&targetType=comment&limit=50`,
      );

      expect(response.status).toBe(200);
      const actions = (
        response.body.items as { action: string; targetId: string }[]
      ).map((item) => `${item.action} ${item.targetId}`);
      expect(actions).toEqual(
        expect.arrayContaining([
          `hide_content ${id('cHide')}`,
          `show_content ${id('cHide')}`,
          `delete_content ${id('cDelete')}`,
          `hide_content ${id('cDeleteHidden')}`,
          `delete_content ${id('cDeleteHidden')}`,
        ]),
      );
    });
  });

  describe('audit records (GEN-07)', () => {
    it('records every moderation action of the admin, after the actions above', async () => {
      const response = await call(
        'admin',
        'get',
        `/api/admin/audit-logs?adminId=${id('admin')}&limit=50`,
      );

      expect(response.status).toBe(200);
      const items = response.body.items as {
        action: string;
        targetType: string;
        targetId: string;
        details: string | null;
      }[];
      const actions = new Set(items.map((item) => item.action));
      for (const action of [
        'dismiss_report',
        'hide_content',
        'delete_content',
      ]) {
        expect(actions).toContain(action);
      }
      // A dismissal targets the report; hiding through a report names it.
      expect(items).toContainEqual(
        expect.objectContaining({
          action: 'dismiss_report',
          targetType: 'report',
          targetId: id('rDismiss'),
        }),
      );
      expect(items).toContainEqual(
        expect.objectContaining({
          action: 'hide_content',
          targetType: 'post',
          details: `report ${id('rHide')}`,
        }),
      );
    });
  });

  describe('Swagger', () => {
    it('documents the routes, their bodies and their answers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const paths = response.body.paths;

      expect(Object.keys(paths[REPORTS].get.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403']),
      );
      expect(Object.keys(paths[`${REPORTS}/{id}`].patch.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
      );
      const content = paths['/api/admin/content/{type}/{id}'];
      expect(Object.keys(content.patch.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
      );
      expect(Object.keys(content.delete.responses)).toEqual(
        expect.arrayContaining(['204', '400', '401', '403', '404']),
      );
      const schemas = response.body.components.schemas;
      expect(schemas.ResolveReportDto.required).toEqual(['action']);
      expect(schemas.ModerateContentDto.required).toEqual(['moderation']);
      expect(schemas.AdminReportResponseDto.properties).toHaveProperty(
        'reporterId',
      );
      expect(schemas.MyPostResponseDto.properties).toHaveProperty('moderation');
    });
  });
});
