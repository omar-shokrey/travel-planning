# Blog Module

## Design decisions

- Blog posts are stored in the `posts` collection using the `BlogPost` Mongoose schema.
- Each post stores the authenticated user's `authorId`; the client cannot choose the author.
- `POST /api/posts` is the route of section 8 of the project description. Listing, the post page, tags and search (BLG-02, BLG-03, BLG-08, BLG-09) add their own routes and indexes.
- A post can be saved as either `draft` or `published`.
- New posts default to `draft` when no status is provided. `status` and `tags` sent as `null` answer 400 (the DTO validates them whenever they are sent, and the schema requires `status`), so no post is stored without a status.
- Published posts receive a `publishedAt` timestamp when they are created.
- `GET /api/posts/mine` (BLG-03) lists the logged-in user's own posts, drafts and published, newest first (`createdAt`, then `_id`), 10 per page by default (GEN-05). It is for the `user` role, like creating a post. The filter is the author id from the login, so nobody can see someone else's drafts. Each row (`MyPostResponseDto`) has the id, title, status, `publishedAt` (left out for a draft), `createdAt`, `updatedAt`, `likeCount` and `commentCount`; the body, tags and images belong to the post page (BLG-02). Index: (`authorId`, `createdAt`, `_id`).
- The post schema has `commentCount` and `likeCount` (default 0), written exactly as in the BLG-05 and BLG-06 PRs, which keep them in step with the `comments` and `likes` collections. "My posts" only reads them. Posts are read hydrated, not with `lean()`, so the default 0 applies to posts stored before the counters existed.
- The `mine` route is declared before any `GET /api/posts/:id` route (BLG-02), so `mine` is never read as a post id.
- Titles and bodies are trimmed and validated before persistence. A title has at most 200 characters and a body at most 20,000 (`POST_TITLE_MAX_LENGTH`, `POST_BODY_MAX_LENGTH` in `create-post.dto.ts`), in the DTO and in the schema. The workbook sets no limit; these keep one request from storing megabytes of text.
- Moments in the response (`createdAt`, `updatedAt`, `publishedAt`) are UTC ISO strings ending in `Z`, made by the mapper. A draft has no `publishedAt`, so it is left out.
- Tags are optional, limited to five tags, limited to 30 characters each, normalized to lowercase, trimmed, and deduplicated.
- Post images are stored as uploaded file names (`images`). Creating a post takes no images: they are added afterwards with `POST /api/posts/:id/images` (BLG-10), under the shared upload rules (GEN-08).
- API responses use a mapper and response DTO rather than exposing the Mongoose document directly.
- Creating posts is restricted to authenticated registered users with the `User` role.

## BLG-04 — Edit and delete own posts

- An author may edit only their own post. They may change the `title`, `body`, `status` and, since BLG-08, the `tags`. Images are managed by their own routes (BLG-10).
- If the post does not exist, the API returns `404 Not Found`. If the post exists but belongs to another user, the API returns `403 Forbidden`.
- When changing a post to `published`, the server sets `publishedAt` if it does not already exist. Editing an already published post keeps its existing `publishedAt`. Changing a published post back to `draft` clears `publishedAt`.
- `DELETE /api/posts/:id` returns `200 OK` when the author's post is successfully deleted.
- Once BLG-05 (comments) and BLG-06 (likes) are merged, deleting a post must also delete its associated comments and likes so no orphaned records remain.

## Post tags (BLG-08)

- **Adding tags at creation already worked (BLG-01).** The rules now live in one place, `PostTags()` in `dto/post-tags.decorator.ts`, used by `CreatePostDto` and `UpdatePostDto`: trimmed, lowercased, de-duplicated, empty ones dropped, at most 5 of at most 30 characters (`POST_TAGS_MAX_COUNT`, `POST_TAG_MAX_LENGTH` in `blog.constants.ts`). Creating a post behaves exactly as before.
- **Editing tags.** `PATCH /api/posts/:id` takes an optional `tags`. The list sent replaces the old one, `[]` removes them all, leaving it out keeps them, and `null` is 400. The owner rules of BLG-04 apply (403 for another user, 404 for a missing post).
- **The tag page.** `GET /api/tags/:tag/posts` is public. The tag is read like a saved tag (trimmed and lowercased); an empty one or one over 30 characters is 400. It lists the **published** posts that have the tag, newest first (`publishedAt`, then `_id`), 10 per page by default (GEN-05). A tag nobody uses gives an empty page, not 404.
- **One row shape for public lists.** `PostSummaryResponseDto` (`toPostSummary`): `id`, `title`, `author: { id, name }`, `publishedAt`, `excerpt`, `tags`, `likeCount`, `commentCount`. The search (BLG-09) uses it too. The excerpt is the first 200 characters of the body (`POST_EXCERPT_LENGTH`), with line breaks and runs of spaces made one space, cut at the last space before the limit (a word that ends exactly at the limit is kept, and one long word is cut without splitting an emoji), plus "…" when something was cut.
- **Author names come from `users`, never from the post.** `PublishedPostsService` reads the names of the authors of a page in one query by their ids, selecting only `name`. `BlogModule` imports `UsersModule`, which exports the `User` model, as the admin, flights and hotels modules do; the users module is not changed. An author whose account is gone or deactivated is shown as "Deleted user".
- **One place says what the public may see.** Every public list starts from `PublishedPostsService.publishedFilter()`, today `status: published`. Hiding by a moderator (GEN-10) and hiding the posts of a deactivated author (ACC-12) add their conditions there, and every public list follows. Until ACC-12, a deactivated author's published posts still show, under "Deleted user". The data model says `authorDeactivated` hides the post, so ACC-12 adds that condition here and changes the matching case of `test/blog-tags.e2e-spec.ts` on purpose.
- **Index:** (`tags`, `publishedAt`, `_id`) for the tag page, as the data model promises.
- **Tests:** `dto/update-post.dto.spec.ts` (tag cases), `posts.service.spec.ts`, `mappers/post-summary.mapper.spec.ts`, `published-posts.service.spec.ts`, `tags.controller.spec.ts` and `test/blog-tags.e2e-spec.ts`. In `test/blog-edit-delete-post.e2e-spec.ts`, the case that refused `tags` on PATCH now refuses `images`, which still have their own routes.
