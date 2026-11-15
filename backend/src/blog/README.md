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

## Likes (BLG-06)

- Likes are stored in their own `likes` collection (`Like` schema): one document per user and post.
- "Like once" is enforced by the unique (`postId`, `userId`) index, not by a read before the write. Two requests at the same moment cannot store two likes; the second answers 409 "You have already liked this post".
- `POST /api/posts/:id/like` and `DELETE /api/posts/:id/like` are for registered users (`user` role) and take no body. The user is the logged-in user. An author may like their own post; the workbook does not forbid it.
- Removing a like that does not exist answers 409 "You have not liked this post". 404 is kept for "no published post has this id", so the two cases cannot be confused.
- Only a published post can be liked. A draft answers 404, the same as a missing post.
- The post keeps a `likeCount`, as in the data model of the spec. It changes with one `$inc` update only after the like was really stored or deleted, and the decrement is guarded so the counter never goes below 0.
- Both routes return `{ postId, liked, likeCount }`, so the client can show the like count without a second request. `likeCount` is not part of `PostResponseDto` yet; BLG-02 adds it to the post page.

## Editing and deleting comments (BLG-07)

- `PATCH /api/comments/:id` and `DELETE /api/comments/:id` are for registered users (`user` role) and only for the comment's own author. The service compares the comment's `authorId` with the logged-in user: a comment of someone else answers 403, a missing comment 404.
- The author of a post cannot edit or delete other users' comments on it. Removing other people's content is moderation and belongs to the admin (GEN-10).
- `UpdateCommentDto` extends `CreateCommentDto` instead of using `PartialType`: a comment has only its text, so an edit must carry it, with the same rules (non-empty, at most 500 characters).
- An edited comment keeps its place in the list, because the list is ordered by `createdAt`. `updatedAt` shows that it was edited.
- Delete answers 204 with no body and removes exactly one record, by id. The post's `commentCount` goes down with one guarded `$inc` update only if this request really deleted the comment, so two delete requests at the same moment lower it once and it never goes below 0.
