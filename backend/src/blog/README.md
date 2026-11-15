# Blog Module

## Design decisions

- Blog posts are stored in the `posts` collection using the `BlogPost` Mongoose schema.
- Each post stores the authenticated user's `authorId`; the client cannot choose the author.
- A post can be saved as either `draft` or `published`.
- New posts default to `draft` when no status is provided.
- Published posts receive a `publishedAt` timestamp when they are created.
- Titles and bodies are trimmed and validated before persistence.
- Tags are optional, limited to five tags, limited to 30 characters each, normalized to lowercase, trimmed, and deduplicated.
- Post images are stored as image references and are handled through the existing uploads system.
- API responses use a mapper and response DTO rather than exposing the Mongoose document directly.
- Creating posts is restricted to authenticated registered users with the `User` role.

## Comments (BLG-05)

- Comments are stored in their own `comments` collection (`Comment` schema), not inside the post, because a post can have any number of them.
- `POST /api/posts/:id/comments` is for registered users (`user` role). The author is the logged-in user and the post comes from the route; the body carries only the text.
- The text is trimmed, must not be empty and has at most 500 characters (`COMMENT_BODY_MAX` in `blog.constants.ts`). A comment of spaces only is rejected.
- Only a published post can be commented on. A draft answers 404, the same as a missing post, so nobody can tell that a draft exists.
- `GET /api/posts/:id/comments` is public and paginated. It returns the comments oldest first (`createdAt`, then `_id` as a tie-breaker), which is the chronological order BLG-05 asks for. The endpoint table of the project description has no route for reading comments, so this one was added; the post page (BLG-02) can call `CommentsService.listForPost` instead.
- The post keeps a `commentCount`, as in the data model of the spec. `CommentsService` raises it with one `$inc` update after a comment is saved, so two comments at the same moment are both counted. It is not part of `PostResponseDto` yet; BLG-02 adds it to the post page.
- Index: (`postId`, `createdAt`) for the list.
