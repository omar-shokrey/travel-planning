# Uploads module

Owner: Salma (GEN-08). Stores and serves the images users upload. This module has no controller: the feature modules own their image routes and call `UploadsService`.

## How a feature module uses it

1. Import `UploadsModule` in the feature module.
2. Put `@UploadImages()` (several files, multipart field `images`) or `@UploadImage()` (one file) on the route, and read the files with `@UploadedFiles()` or `@UploadedFile()`. The decorator also documents the file picker in Swagger.
3. In the service, call `assertWithinLimit(owner, existing, incoming)` with the number of images the owner already has, then `saveImages(files)` (or `saveImage(file)`), and keep each returned `filename` in the owner's document.
4. When an image or its owner is deleted, call `deleteImage(filename)`.

In use on `develop` today: the airline logo (flights, FLT-01), the hotel photos (hotels, HTL-01), and the admin moderation (admin, GEN-10), which deletes the image files of a post or itinerary that an administrator deletes, directly or from a report. Post images (BLG-10) and activity images (ITN-12) are not built yet; the `images` fields of posts and activities are ready for them.

## Design decisions

- **The limits live in `uploads.constants.ts`.** An image is at most 5 MB (`MAX_IMAGE_BYTES`). `IMAGE_LIMITS` allows 5 images per post, activity or hotel and 1 logo per airline. `assertWithinLimit` answers 400 with a message that names the limit and how many the owner already has. `MAX_FILES_PER_REQUEST` (10) only protects memory; the real limit is the per-owner one.
- **The type comes from the file's first bytes**, not from its name or the type the client declares (`image-format.ts`). Only JPG and PNG are accepted: anything else answers 415. A file over 5 MB answers 413, from multer (`IMAGE_UPLOAD_OPTIONS`) or from the service's own check. No image at all answers 400.
- **Check every file, then write.** multer keeps the files in memory (no folder is set), so `saveImages` checks all of them before any reaches the disk, and one bad file stores nothing. If a write fails halfway, the files already written in that call are deleted again.
- **Random names.** A stored file is named `<uuid>.jpg` or `<uuid>.png`, written with the `wx` flag so it never overwrites another file. The client's file name is never used on disk.
- **`deleteImage` is safe to call with any value.** It ignores a name that does not match the names it gives (so a bad value in the database can never reach a file outside the uploads folder), and it does nothing when the file is already gone.
- **Files are public.** `app.setup.ts` serves the folder at `/api/uploads/<filename>` (`imageUrl()` builds the URL), with no directory index, and with a 7-day `immutable` cache, because a name never gets different content. A missing file answers the standard 404 body.
- **The folder is `UPLOADS_DIR`** (default `uploads`, relative to `backend/` unless absolute; checked in `config/env.validation.ts`). `backend/uploads/` is git-ignored. The end-to-end tests point it at a temporary folder.
- **A file can be shared by two owners.** A cloned itinerary keeps the activity image names of its source (ITN-21), so the same file belongs to both. `deleteImage` does not know about owners: the caller must check that no other owner still uses a file before deleting it (as `ItinerariesService.removeByAdmin` does).

## Tests

`uploads.service.spec.ts` (limits, checks, writing, cleanup and deleting) and `image-format.spec.ts` (the first-bytes check). The routes that use the service are tested in their own modules.
