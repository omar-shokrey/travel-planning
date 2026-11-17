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

## Post images (BLG-10)

- **Two routes, for the author only.** `POST /api/posts/:id/images` adds images and `DELETE /api/posts/:id/images/:imageId` removes one. Both are `@Roles(Role.User)`; the service then checks that the caller wrote the post (404 for a missing post, 403 for someone else's). Drafts and published posts both take images. They live in `PostImagesController` and `PostImagesService`, so `PostsController` is unchanged. `BlogModule` imports `UploadsModule`.
- **The shared upload rules (GEN-08).** `@UploadImages()` reads the multipart field `images`. `UploadsService` refuses a file over 5 MB (413), a file that is not a JPG or PNG by its first bytes (415) and a request with no file (400). `assertWithinLimit('post', existing, incoming)` refuses more than 5 images in all (400) before anything is saved.
- **The limit holds under concurrent uploads.** After saving, the names are added with one conditional update whose filter matches only while the post still has room for all of them (`images.<5 - incoming>` must not exist). Two uploads at the same time can therefore never pass 5: the one that loses gets 400 with the limit message (without the "It already has" count when it lost at the update). Hotel photos (HTL-01) use a stricter filter (the count must be unchanged, 409 otherwise); here an upload that still fits succeeds even if another one landed first.
- **No orphan files.** When the conditional update does not match, or anything fails after saving, the files just saved are deleted again. Every file is tried; one that cannot be deleted is logged, and the caller still gets the original error, not a 500 from the cleanup.
- **`imageId` is the stored file name**, as in the hotel photos route and as `BlogPost.images` stores it. Removing pulls the name in one update (404 when the post has no such image, and then no file is touched) and then deletes the file.
- **The answer is the post** (`PostResponseDto`, 200), as the hotel photo routes answer with the hotel. `images` lists the file names; each is served at `/api/uploads/<name>`.
- **Deleting a post must delete its image files too.** `PostsService.remove` comes with BLG-04 (#159), which is not in this branch. Until it calls `UploadsService.deleteImage` for each name in `post.images`, a deleted post leaves its image files on disk.
- **Tests:** `post-images.service.spec.ts` (limit, conditional-update miss, cleanup, delete), `post-images.controller.spec.ts` (roles) and `test/blog-images.e2e-spec.ts` (uploads, limits, file types, sizes, roles, two uploads at once, removal and the file on disk).
