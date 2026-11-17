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
- `PostsService.findPublishedAuthorId(postId)` (GEN-09) is used by the reports module: it returns the author id of a published post, or `null` for a missing post or a draft, so a draft is never revealed. No controller exposes it. When posts get a moderation or author-deactivated field (GEN-10, ACC-12), it must leave those posts out for everyone but the author too.
