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
