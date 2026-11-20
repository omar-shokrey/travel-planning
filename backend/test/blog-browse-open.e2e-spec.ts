import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { DELETED_USER_NAME } from './../src/blog/blog.constants';
import { BlogPost } from './../src/blog/models/blog-post.schema';
import { CommentModeration } from './../src/blog/models/comment-moderation.enum';
import { Comment } from './../src/blog/models/comment.schema';
import { Like } from './../src/blog/models/like.schema';
import { PostModeration } from './../src/blog/models/post-moderation.enum';
import { PostStatus } from './../src/blog/models/post-status.enum';
import { Role } from './../src/common/enums/role.enum';
import { UserStatus } from './../src/common/enums/user-status.enum';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import { sessionCookieFor } from './support/session-cookie';

/**
 * One token for the whole run. Every name, title, tag and file name below
 * carries it, so a search, a tag page or an assertion finds only what this
 * run made, even next to the other suites on the same -test database.
 */
const RUN = randomUUID().replaceAll('-', '').slice(0, 12);
const TAG = `blg02t${RUN}`;
const OTHER_TAG = `blg02o${RUN}`;
const WORD = `blg02w${RUN}`;
const UNUSED_TAG = `blg02u${RUN}`;

interface SummaryRow {
  id: string;
  title: string;
  author: { id: string; name: string };
  publishedAt: string;
  excerpt: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
}

interface PageComment {
  id: string;
  author: { id: string; name: string };
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface PostPage {
  id: string;
  title: string;
  author: { id: string; name: string };
  publishedAt: string;
  body: string;
  tags: string[];
  images: string[];
  likeCount: number;
  commentCount: number;
  comments: {
    items: PageComment[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  };
}

describe('Browse posts by tag and open a post (e2e, BLG-02)', () => {
  let app: NestExpressApplication;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let comments: Model<Comment>;
  let likes: Model<Like>;

  /** What this run created. Each record is deleted by id at the end. */
  const createdUserIds: string[] = [];
  const createdPostIds: string[] = [];
  const createdCommentIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const browse = (query: Record<string, string>) =>
    http().get('/api/posts').query(query);
  const idsOf = (response: request.Response) =>
    (response.body.items as SummaryRow[]).map((row) => row.id);
  const openPost = (id: string, query: Record<string, string> = {}) =>
    http().get(`/api/posts/${id}`).query(query);

  const createUser = async (
    name: string,
    status: UserStatus = UserStatus.Active,
  ) => {
    const user = await users.create({
      name: `${name} ${RUN}`,
      email: `blg02-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role: Role.User,
      status,
      consentAcceptedAt: new Date(),
    });
    const id = user._id.toString();
    createdUserIds.push(id);
    return id;
  };

  /** A post written straight to the database, so the test controls the dates. */
  const createPost = async (
    fields: Omit<Partial<BlogPost>, 'authorId'> & { authorId: string },
  ) => {
    const { authorId, ...rest } = fields;
    const post = await posts.create({
      authorId: new Types.ObjectId(authorId),
      title: 'Untitled',
      body: 'Body of a BLG-02 test post',
      status: PostStatus.Published,
      publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      ...rest,
    });
    const id = post._id.toString();
    createdPostIds.push(id);
    return id;
  };

  /** A comment made through the API, as a logged-in user does it. */
  const commentAs = async (postId: string, cookie: string, body: string) => {
    const response = await http()
      .post(`/api/posts/${postId}/comments`)
      .set('Cookie', cookie)
      .send({ body });
    expect(response.status).toBe(201);
    const id = (response.body as { id: string }).id;
    createdCommentIds.push(id);
    return id;
  };

  let author: string;
  let reader: string;
  let readerCookie: string;
  let commenter: string;
  let commenterCookie: string;
  let authorCookie: string;

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
    comments = app.get<Model<Comment>>(getModelToken(Comment.name));
    likes = app.get<Model<Like>>(getModelToken(Like.name));

    author = await createUser('BLG-02 Author');
    reader = await createUser('BLG-02 Reader');
    commenter = await createUser('BLG-02 Commenter');
    authorCookie = await sessionCookieFor(app, author);
    readerCookie = await sessionCookieFor(app, reader);
    commenterCookie = await sessionCookieFor(app, commenter);
  });

  afterAll(async () => {
    for (const id of createdCommentIds) {
      await comments.findByIdAndDelete(id);
    }
    // Only the likes on the posts this run created, one by one by id.
    for (const postId of createdPostIds) {
      const own = await likes
        .find({ postId: new Types.ObjectId(postId) })
        .select('_id')
        .lean()
        .exec();
      for (const { _id } of own) {
        await likes.findByIdAndDelete(_id).exec();
      }
    }
    for (const id of createdPostIds) {
      await posts.findByIdAndDelete(id);
    }
    for (const id of createdUserIds) {
      await deleteSessionsOf(app, id);
      await users.findByIdAndDelete(id);
    }
    await app.close();
  });

  describe('GET /api/posts?tag= (browse by tag)', () => {
    let oldest: string;
    let middle: string;
    let newest: string;
    let otherTag: string;
    let draft: string;
    let hidden: string;

    beforeAll(async () => {
      oldest = await createPost({
        authorId: author,
        title: `${WORD} oldest`,
        tags: [TAG, `extra${RUN}`],
        publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      });
      middle = await createPost({
        authorId: author,
        title: `${WORD} middle`,
        tags: [TAG],
        publishedAt: new Date('2026-11-02T10:00:00.000Z'),
      });
      newest = await createPost({
        authorId: author,
        title: 'Plain newest',
        tags: [TAG],
        publishedAt: new Date('2026-11-03T10:00:00.000Z'),
      });
      otherTag = await createPost({
        authorId: author,
        title: `${WORD} on another tag`,
        tags: [OTHER_TAG],
        publishedAt: new Date('2026-11-04T10:00:00.000Z'),
      });
      draft = await createPost({
        authorId: author,
        title: `${WORD} draft`,
        tags: [TAG],
        status: PostStatus.Draft,
        publishedAt: undefined,
      });
      hidden = await createPost({
        authorId: author,
        title: `${WORD} hidden by an admin`,
        tags: [TAG],
        moderation: PostModeration.Hidden,
        publishedAt: new Date('2026-11-05T10:00:00.000Z'),
      });
    });

    it('is open to guests and lists only the published posts of the tag, newest first', async () => {
      const response = await browse({ tag: TAG });

      expect(response.status).toBe(200);
      expect(idsOf(response)).toEqual([newest, middle, oldest]);
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 3,
        totalPages: 1,
      });
    });

    it('leaves a draft and a post an admin hid out of the list and out of the total', async () => {
      const response = await browse({ tag: TAG });

      expect(idsOf(response)).not.toContain(draft);
      expect(idsOf(response)).not.toContain(hidden);
      expect(response.body.meta.total).toBe(3);
    });

    it('does not list a post of another tag', async () => {
      const response = await browse({ tag: TAG });
      const other = await browse({ tag: OTHER_TAG });

      expect(idsOf(response)).not.toContain(otherTag);
      expect(idsOf(other)).toEqual([otherTag]);
    });

    it('returns the summary rows of the other public lists, and nothing internal', async () => {
      const response = await browse({ tag: TAG });
      const rows = response.body.items as SummaryRow[];

      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual([
          'author',
          'commentCount',
          'excerpt',
          'id',
          'likeCount',
          'publishedAt',
          'tags',
          'title',
        ]);
        expect(row.author).toEqual({
          id: author,
          name: `BLG-02 Author ${RUN}`,
        });
        expect(row.tags).toContain(TAG);
      }
      expect(rows[2]).toMatchObject({
        id: oldest,
        publishedAt: '2026-11-01T10:00:00.000Z',
        excerpt: 'Body of a BLG-02 test post',
        tags: [TAG, `extra${RUN}`],
      });
    });

    it('reads the tag like a saved tag: capitals and outer spaces are ignored', async () => {
      const response = await browse({ tag: `  ${TAG.toUpperCase()}  ` });

      expect(response.status).toBe(200);
      expect(idsOf(response)).toEqual([newest, middle, oldest]);
    });

    it('narrows a search to the tag: both the keyword and the tag must match', async () => {
      const response = await browse({ q: WORD, tag: TAG });

      // `oldest` and `middle` have the keyword in the title and the tag; the
      // post of the other tag has the keyword but not the tag; `newest` has
      // the tag but not the keyword.
      expect(response.status).toBe(200);
      expect(idsOf(response)).toEqual([middle, oldest]);
      expect(response.body.meta.total).toBe(2);
    });

    it('does not let a keyword that matches only the tag reach a post of another tag', async () => {
      // `q` finds the posts of TAG (by tag), `tag` asks for OTHER_TAG: no
      // post is in both.
      const response = await browse({ q: TAG, tag: OTHER_TAG });

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
      expect(response.body.meta.total).toBe(0);
    });

    it('still searches every tag when no tag is given', async () => {
      const response = await browse({ q: WORD });

      expect(idsOf(response).sort()).toEqual([middle, oldest, otherTag].sort());
      expect(response.body.meta.total).toBe(3);
    });

    it('answers an empty page, not 404, for a tag nobody uses', async () => {
      const response = await browse({ tag: UNUSED_TAG });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });

    it('pages the list of a tag and counts all of it', async () => {
      const first = await browse({ tag: TAG, limit: '2' });
      const second = await browse({ tag: TAG, limit: '2', page: '2' });
      const beyond = await browse({ tag: TAG, limit: '2', page: '3' });

      expect(idsOf(first)).toEqual([newest, middle]);
      expect(idsOf(second)).toEqual([oldest]);
      expect(second.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(beyond.body.items).toEqual([]);
      expect(beyond.body.meta.total).toBe(3);
    });

    it('gives exactly the same items and meta as GET /api/tags/:tag/posts', async () => {
      const queries: Record<string, string>[] = [
        {},
        { limit: '2' },
        { limit: '2', page: '2' },
        { limit: '1', page: '3' },
        { limit: '50' },
      ];
      for (const query of queries) {
        const byQuery = await browse({ tag: TAG, ...query });
        const byPath = await http().get(`/api/tags/${TAG}/posts`).query(query);

        expect(byQuery.status).toBe(200);
        expect(byPath.status).toBe(200);
        expect(byQuery.body).toEqual(byPath.body);
      }
    });

    it('lists the same for a logged-in user as for a guest', async () => {
      const guest = await browse({ tag: TAG });
      const loggedIn = await browse({ tag: TAG }).set('Cookie', readerCookie);

      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body).toEqual(guest.body);
    });

    it('lists the newest posts, with the same row shape, when no tag is given', async () => {
      const response = await browse({});

      expect(response.status).toBe(200);
      // Not scoped to this run: only what holds whatever other posts exist.
      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.items.length).toBeLessThanOrEqual(10);
      expect(response.body.meta.total).toBeGreaterThanOrEqual(4);
      for (const row of response.body.items as SummaryRow[]) {
        expect(Object.keys(row).sort()).toEqual([
          'author',
          'commentCount',
          'excerpt',
          'id',
          'likeCount',
          'publishedAt',
          'tags',
          'title',
        ]);
      }
      const ids = idsOf(response);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(hidden);
    });

    it('lists the posts of every tag when no tag is given', async () => {
      // The token of this run is in the author's name, so this keyword
      // narrows the search to this run's posts, whatever their tag.
      const response = await browse({ q: RUN, limit: '50' });

      expect(idsOf(response)).toEqual(
        expect.arrayContaining([newest, middle, oldest, otherTag]),
      );
      expect(idsOf(response)).not.toContain(draft);
      expect(idsOf(response)).not.toContain(hidden);
    });

    it.each([
      ['an empty tag', '/api/posts?tag='],
      ['a tag of spaces only', '/api/posts?tag=%20'],
      ['a tag of several spaces', '/api/posts?tag=%20%20%20'],
      ['a tag over 30 characters', `/api/posts?tag=${'a'.repeat(31)}`],
      ['a tag sent twice', '/api/posts?tag=a&tag=b'],
      ['an empty tag next to a good keyword', '/api/posts?q=nile&tag='],
    ])('refuses %s with 400', async (_label, url) => {
      const response = await http().get(url);

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(response.body.errors).toEqual([
        expect.objectContaining({ field: 'tag' }),
      ]);
    });

    it('tells the caller to leave the tag out when it is empty', async () => {
      const response = await http().get('/api/posts?tag=');

      expect(response.body.errors).toEqual([
        {
          field: 'tag',
          messages: ['tag must not be empty: leave it out to list all posts'],
        },
      ]);
    });

    it('still refuses a parameter that is not allowed', async () => {
      const response = await browse({ tag: TAG, sort: 'likes' });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/posts/:id (a post page)', () => {
    let richPost: string;
    let firstComment: string;
    let hiddenComment: string;
    let secondComment: string;
    let draftPost: string;
    let hiddenPost: string;

    beforeAll(async () => {
      richPost = await createPost({
        authorId: author,
        title: `Three days in Cairo ${RUN}`,
        body: 'I spent three amazing days exploring Cairo.\nThe second day was the best.',
        tags: [`page${RUN}`, 'egypt'],
        images: [`first-${RUN}.jpg`, `second-${RUN}.png`],
        publishedAt: new Date('2026-11-05T08:30:00.000Z'),
      });
      draftPost = await createPost({
        authorId: author,
        title: 'A draft',
        status: PostStatus.Draft,
        publishedAt: undefined,
      });
      hiddenPost = await createPost({
        authorId: author,
        title: 'A post an admin hid',
        moderation: PostModeration.Hidden,
      });

      // A like and three comments through the API, so the counters are the
      // ones the server keeps.
      await http()
        .post(`/api/posts/${richPost}/like`)
        .set('Cookie', readerCookie)
        .expect(201);
      firstComment = await commentAs(richPost, readerCookie, 'First comment');
      hiddenComment = await commentAs(
        richPost,
        commenterCookie,
        'Comment an admin hid',
      );
      secondComment = await commentAs(
        richPost,
        commenterCookie,
        'Second comment',
      );
      // What hiding does (GEN-10): the comment is marked and the post's
      // counter goes down by one. Done by id, as the admin route does it.
      await comments.updateOne(
        { _id: hiddenComment },
        { $set: { moderation: CommentModeration.Hidden } },
      );
      await posts.updateOne({ _id: richPost }, { $inc: { commentCount: -1 } });
    });

    it('is open to guests and shows the title, author, date, body, tags, images, counters and comments', async () => {
      const response = await openPost(richPost);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: richPost,
        title: `Three days in Cairo ${RUN}`,
        author: { id: author, name: `BLG-02 Author ${RUN}` },
        publishedAt: '2026-11-05T08:30:00.000Z',
        body: 'I spent three amazing days exploring Cairo.\nThe second day was the best.',
        tags: [`page${RUN}`, 'egypt'],
        images: [`first-${RUN}.jpg`, `second-${RUN}.png`],
        likeCount: 1,
        commentCount: 2,
        comments: {
          items: [
            {
              id: firstComment,
              author: { id: reader, name: `BLG-02 Reader ${RUN}` },
              body: 'First comment',
              createdAt: expect.stringMatching(/Z$/),
              updatedAt: expect.stringMatching(/Z$/),
            },
            {
              id: secondComment,
              author: { id: commenter, name: `BLG-02 Commenter ${RUN}` },
              body: 'Second comment',
              createdAt: expect.stringMatching(/Z$/),
              updatedAt: expect.stringMatching(/Z$/),
            },
          ],
          meta: { page: 1, limit: 10, total: 2, totalPages: 1 },
        },
      });
    });

    it('has exactly the documented keys and none of the left-out ones', async () => {
      const page = (await openPost(richPost)).body as PostPage;

      expect(Object.keys(page).sort()).toEqual([
        'author',
        'body',
        'commentCount',
        'comments',
        'id',
        'images',
        'likeCount',
        'publishedAt',
        'tags',
        'title',
      ]);
      for (const left of [
        'status',
        'moderation',
        'authorId',
        'createdAt',
        'updatedAt',
        'liked',
        'viewer',
      ]) {
        expect(page).not.toHaveProperty(left);
      }
      for (const item of page.comments.items) {
        expect(Object.keys(item).sort()).toEqual([
          'author',
          'body',
          'createdAt',
          'id',
          'updatedAt',
        ]);
      }
    });

    it('shows counters that match the likes and comments made, and a comments total equal to the comment count', async () => {
      const page = (await openPost(richPost)).body as PostPage;

      expect(page.likeCount).toBe(1);
      expect(page.commentCount).toBe(2);
      expect(page.comments.meta.total).toBe(page.commentCount);
      expect(page.comments.items).toHaveLength(page.commentCount);
    });

    it('lists the comments oldest first', async () => {
      const page = (await openPost(richPost)).body as PostPage;

      expect(page.comments.items.map((item) => item.body)).toEqual([
        'First comment',
        'Second comment',
      ]);
      const [first, second] = page.comments.items;
      expect(new Date(first.createdAt).getTime()).toBeLessThanOrEqual(
        new Date(second.createdAt).getTime(),
      );
    });

    it('leaves a comment an admin hid out of the page and out of the total (GEN-10)', async () => {
      const page = (await openPost(richPost, { commentsLimit: '50' }))
        .body as PostPage;

      expect(page.comments.items.map((item) => item.id)).not.toContain(
        hiddenComment,
      );
      expect(page.comments.meta.total).toBe(2);
      // The comment route agrees with the page.
      const listed = await http().get(`/api/posts/${richPost}/comments`);
      expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual(
        page.comments.items.map((item) => item.id),
      );
      expect(listed.body.meta.total).toBe(page.comments.meta.total);
    });

    it('pages the comments with commentsPage and commentsLimit', async () => {
      const first = (await openPost(richPost, { commentsLimit: '1' }))
        .body as PostPage;
      const second = (
        await openPost(richPost, { commentsLimit: '1', commentsPage: '2' })
      ).body as PostPage;
      const beyond = (
        await openPost(richPost, { commentsLimit: '1', commentsPage: '3' })
      ).body as PostPage;

      expect(first.comments.items.map((item) => item.id)).toEqual([
        firstComment,
      ]);
      expect(second.comments.items.map((item) => item.id)).toEqual([
        secondComment,
      ]);
      expect(second.comments.meta).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      expect(beyond.comments.items).toEqual([]);
      expect(beyond.comments.meta.total).toBe(2);
      // The post itself is the same on every page of the comments.
      expect({ ...second, comments: undefined }).toEqual({
        ...first,
        comments: undefined,
      });
    });

    it('gives a logged-in user the same page as a guest: nothing about the viewer', async () => {
      const guest = await openPost(richPost);
      const loggedIn = await openPost(richPost).set('Cookie', readerCookie);

      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body).toEqual(guest.body);
    });

    it('shows an empty list of comments, not an error, for a post without any', async () => {
      const bare = await createPost({
        authorId: author,
        title: 'No comments yet',
      });

      const response = await openPost(bare);

      expect(response.status).toBe(200);
      expect(response.body.comments).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
      expect(response.body).toMatchObject({
        likeCount: 0,
        commentCount: 0,
        tags: [],
        images: [],
      });
    });

    it('shows 0 counters and no images for a post stored before they existed', async () => {
      const id = await createPost({
        authorId: author,
        title: 'An old post',
        publishedAt: new Date('2026-10-01T10:00:00.000Z'),
      });
      // Take the fields away again, as a post stored before they existed
      // does not have them (a lean read applies no schema default). `tags` is
      // kept: the public lists read it, and this post is in them too.
      await posts.updateOne(
        { _id: id },
        {
          $unset: {
            likeCount: 1,
            commentCount: 1,
            images: 1,
            moderation: 1,
          },
        },
      );

      const response = await openPost(id);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id,
        likeCount: 0,
        commentCount: 0,
        tags: [],
        images: [],
      });
    });

    it('answers 404 "Post not found" for a post of an author whose account is deactivated (ACC-12)', async () => {
      // ACC-12 hides the posts of a deactivated author: the deactivation sets
      // `authorDeactivated` on them, so the post page no longer shows them.
      const gone = await createUser('BLG-02 Gone', UserStatus.Deactivated);
      const post = await createPost({
        authorId: gone,
        title: 'By a ghost',
        authorDeactivated: true,
      });

      const response = await openPost(post);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Post not found');
    });

    it('shows "Deleted user" for a commenter whose account is deactivated', async () => {
      const gone = await createUser('BLG-02 Gone', UserStatus.Deactivated);
      const post = await createPost({
        authorId: author,
        title: 'Commented by a ghost',
        commentCount: 1,
      });
      const saved = await comments.create({
        postId: new Types.ObjectId(post),
        authorId: new Types.ObjectId(gone),
        body: 'Written before I left',
      });
      createdCommentIds.push(saved._id.toString());

      const response = await openPost(post);

      expect(response.status).toBe(200);
      expect(response.body.author.name).toBe(`BLG-02 Author ${RUN}`);
      expect(response.body.comments.items).toHaveLength(1);
      expect(response.body.comments.items[0].author).toEqual({
        id: gone,
        name: DELETED_USER_NAME,
      });
    });

    describe('what it never shows', () => {
      it('answers 404 "Post not found" for a draft, to a guest and to its author', async () => {
        const guest = await openPost(draftPost);
        const owner = await openPost(draftPost).set('Cookie', authorCookie);

        for (const response of [guest, owner]) {
          expect(response.status).toBe(404);
          expect(response.body.message).toBe('Post not found');
        }
      });

      it('answers 404 "Post not found" for a post an admin hid, to a guest, a reader and its author', async () => {
        const guest = await openPost(hiddenPost);
        const other = await openPost(hiddenPost).set('Cookie', readerCookie);
        const owner = await openPost(hiddenPost).set('Cookie', authorCookie);

        for (const response of [guest, other, owner]) {
          expect(response.status).toBe(404);
          expect(response.body.message).toBe('Post not found');
        }
      });

      it('answers 404 "Post not found" for an id nobody has', async () => {
        const response = await openPost(new Types.ObjectId().toString());

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('Post not found');
      });

      it('answers a draft, a hidden post and a missing post alike, so nobody learns that one exists', async () => {
        const answers = await Promise.all(
          [draftPost, hiddenPost, new Types.ObjectId().toString()].map(
            async (id) => {
              const { statusCode, error, message } = (await openPost(id)).body;
              return { statusCode, error, message };
            },
          ),
        );

        expect(answers[1]).toEqual(answers[0]);
        expect(answers[2]).toEqual(answers[0]);
      });

      it('shows the post again once an admin shows it again (GEN-10)', async () => {
        await posts.updateOne(
          { _id: hiddenPost },
          { $set: { moderation: PostModeration.Visible } },
        );
        try {
          expect((await openPost(hiddenPost)).status).toBe(200);
        } finally {
          await posts.updateOne(
            { _id: hiddenPost },
            { $set: { moderation: PostModeration.Hidden } },
          );
        }
        expect((await openPost(hiddenPost)).status).toBe(404);
      });
    });

    it.each([
      ['an id that is not an id', '/api/posts/not-an-id'],
      ['an id that is too short', '/api/posts/6740f1c2a4b5c6d7e8f9'],
    ])('refuses %s with 400', async (_label, url) => {
      const response = await http().get(url);

      expect(response.status).toBe(400);
    });

    it.each([
      ['an unknown parameter', { sort: 'likes' }],
      ['`page`, which is not a parameter of the page', { page: '2' }],
      ['`limit`, which is not a parameter of the page', { limit: '5' }],
      ['commentsPage 0', { commentsPage: '0' }],
      ['commentsPage -1', { commentsPage: '-1' }],
      ['commentsPage 1.5', { commentsPage: '1.5' }],
      ['commentsPage as text', { commentsPage: 'two' }],
      ['commentsLimit 0', { commentsLimit: '0' }],
      ['commentsLimit 51', { commentsLimit: '51' }],
      ['commentsLimit as text', { commentsLimit: 'many' }],
    ] as [string, Record<string, string>][])(
      'refuses %s with 400',
      async (_label, query) => {
        const response = await openPost(richPost, query);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation failed');
      },
    );

    it('accepts the largest page size, 50', async () => {
      const response = await openPost(richPost, { commentsLimit: '50' });

      expect(response.status).toBe(200);
      expect(response.body.comments.meta.limit).toBe(50);
    });
  });

  describe('the routes next to it', () => {
    it('still answers GET /api/posts/mine with the posts of the logged-in user, never as a post id', async () => {
      const response = await http()
        .get('/api/posts/mine')
        .query({ limit: '50' })
        .set('Cookie', authorCookie);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('meta');
      expect(response.body).not.toHaveProperty('title');
      const mine = (response.body.items as { id: string }[]).map(
        (row) => row.id,
      );
      // Everything this run wrote for the author, drafts and hidden posts
      // included, and nothing of any other user.
      expect(mine.length).toBeGreaterThan(0);
      for (const id of mine) {
        expect(createdPostIds).toContain(id);
      }
    });

    it('answers GET /api/posts/mine to a guest with 401, not 400 or 404', async () => {
      const response = await http().get('/api/posts/mine');

      expect(response.status).toBe(401);
    });

    it('answers GET /api/posts/mine for a reader with no posts: an empty page', async () => {
      const response = await http()
        .get('/api/posts/mine')
        .set('Cookie', readerCookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      });
    });
  });

  // Liking, commenting and reporting need a login (ACC-10). That is covered
  // for every route at once by test/guest-access.e2e-spec.ts, which sends a
  // guest to each route that is not public (POST /api/posts/:id/like,
  // POST /api/posts/:id/comments and POST /api/reports among them) and expects
  // 401, so it is not repeated here.

  describe('Swagger', () => {
    interface Operation {
      tags?: string[];
      security?: unknown;
      parameters?: { name: string; in: string; required?: boolean }[];
      responses: Record<string, unknown>;
    }
    let document: {
      paths: Record<string, { get?: Operation }>;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    beforeAll(async () => {
      document = (await http().get('/api/docs-json').expect(200)).body;
    });

    it('documents `tag` on the list of posts, which stays public', () => {
      const operation = document.paths['/api/posts'].get!;

      expect(operation.security).toBeUndefined();
      expect(operation.parameters?.map((parameter) => parameter.name)).toEqual(
        expect.arrayContaining(['q', 'tag', 'page', 'limit']),
      );
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400']),
      );
    });

    it('lists GET /api/posts/{id} under Blog, public, with 200, 400 and 404', () => {
      const operation = document.paths['/api/posts/{id}'].get!;

      expect(operation.tags).toEqual(['Blog']);
      expect(operation.security).toBeUndefined();
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(['200', '400', '404']),
      );
      expect(operation.parameters?.map((parameter) => parameter.name)).toEqual(
        expect.arrayContaining(['id', 'commentsPage', 'commentsLimit']),
      );
      expect(
        operation.parameters?.find((parameter) => parameter.name === 'id'),
      ).toMatchObject({ in: 'path', required: true });
    });

    it('keeps the lock on GET /api/posts/mine', () => {
      const operation = document.paths['/api/posts/mine'].get!;

      expect(operation.security).toBeDefined();
    });

    it('describes every field of the page and of its comments', () => {
      const page = document.components.schemas.PostPageResponseDto;
      const comment = document.components.schemas.PostCommentResponseDto;

      expect(Object.keys(page.properties ?? {}).sort()).toEqual([
        'author',
        'body',
        'commentCount',
        'comments',
        'id',
        'images',
        'likeCount',
        'publishedAt',
        'tags',
        'title',
      ]);
      expect(Object.keys(comment.properties ?? {}).sort()).toEqual([
        'author',
        'body',
        'createdAt',
        'id',
        'updatedAt',
      ]);
    });
  });
});
