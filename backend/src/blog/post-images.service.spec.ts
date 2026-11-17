import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type { UploadsService } from '../uploads/uploads.service';
import type { BlogPost } from './models/blog-post.schema';
import { PostStatus } from './models/post-status.enum';
import {
  POST_IMAGE_LIMIT_MESSAGE,
  PostImagesService,
} from './post-images.service';

const postId = '6740f1c2a4b5c6d7e8f90abc';
const authorId = '6740f1c2a4b5c6d7e8f90001';
const otherId = '6740f1c2a4b5c6d7e8f90002';
const files = [
  { originalname: 'a.png', buffer: Buffer.from('a') },
  { originalname: 'b.png', buffer: Buffer.from('b') },
];

const stored = (images: string[]) => ({
  _id: new Types.ObjectId(postId),
  authorId: new Types.ObjectId(authorId),
  title: 'A post',
  body: 'Body',
  status: PostStatus.Draft,
  tags: [],
  images,
  createdAt: new Date('2026-11-15T10:00:00.000Z'),
  updatedAt: new Date('2026-11-15T10:00:00.000Z'),
});

function setup(images: string[] = []) {
  const findByIdExec = jest.fn().mockResolvedValue(stored(images));
  const updateExec = jest.fn();
  const posts = {
    findById: jest.fn(() => ({ exec: findByIdExec })),
    findOneAndUpdate: jest.fn(() => ({ exec: updateExec })),
    exists: jest.fn().mockResolvedValue({ _id: postId }),
  };
  const uploads = {
    // The real limit check, so the tests see its answer.
    assertWithinLimit: jest.fn(
      (_owner: string, existing: number, incoming: number) => {
        if (existing + incoming > 5) {
          throw new BadRequestException('A post can have at most 5 images.');
        }
      },
    ),
    saveImages: jest.fn().mockResolvedValue([
      { filename: 'new-1.png', url: '/api/uploads/new-1.png' },
      { filename: 'new-2.png', url: '/api/uploads/new-2.png' },
    ]),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PostImagesService(
    posts as unknown as Model<BlogPost>,
    uploads as unknown as UploadsService,
  );
  return { findByIdExec, updateExec, posts, uploads, service };
}

describe('PostImagesService (BLG-10)', () => {
  describe('addImages', () => {
    it('saves the files, then adds their names in one update that needs room for all of them', async () => {
      const { posts, updateExec, uploads, service } = setup(['old.png']);
      updateExec.mockResolvedValue(
        stored(['old.png', 'new-1.png', 'new-2.png']),
      );

      const post = await service.addImages(postId, authorId, files);

      expect(uploads.assertWithinLimit).toHaveBeenCalledWith('post', 1, 2);
      expect(uploads.saveImages).toHaveBeenCalledWith(files);
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        // Room for 2 more: the post has no image at position 3 (0-based).
        { _id: new Types.ObjectId(postId), 'images.3': { $exists: false } },
        { $push: { images: { $each: ['new-1.png', 'new-2.png'] } } },
        { returnDocument: 'after' },
      );
      expect(post.images).toEqual(['old.png', 'new-1.png', 'new-2.png']);
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('refuses an upload past 5 images before saving anything', async () => {
      const { uploads, service } = setup(['1', '2', '3', '4']);

      await expect(
        service.addImages(postId, authorId, files),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(uploads.saveImages).not.toHaveBeenCalled();
    });

    it('answers 400 and deletes the saved files when another upload took the room', async () => {
      const { updateExec, uploads, service } = setup(['old.png']);
      updateExec.mockResolvedValue(null);

      await expect(service.addImages(postId, authorId, files)).rejects.toThrow(
        POST_IMAGE_LIMIT_MESSAGE,
      );
      expect(uploads.deleteImage).toHaveBeenCalledWith('new-1.png');
      expect(uploads.deleteImage).toHaveBeenCalledWith('new-2.png');
    });

    it('answers 404 and deletes the saved files when the post was deleted meanwhile', async () => {
      const { posts, updateExec, uploads, service } = setup();
      updateExec.mockResolvedValue(null);
      posts.exists.mockResolvedValue(null);

      await expect(
        service.addImages(postId, authorId, files),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(uploads.deleteImage).toHaveBeenCalledTimes(2);
    });

    it('needs an empty post for 5 images at once', async () => {
      const { posts, updateExec, uploads, service } = setup();
      uploads.saveImages.mockResolvedValue(
        ['1', '2', '3', '4', '5'].map((n) => ({ filename: `${n}.png` })),
      );
      updateExec.mockResolvedValue(
        stored(['1.png', '2.png', '3.png', '4.png', '5.png']),
      );

      await service.addImages(postId, authorId, files);

      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(postId), 'images.0': { $exists: false } },
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('keeps the original error when a saved file cannot be deleted, and still tries every file', async () => {
      const { updateExec, uploads, service } = setup(['old.png']);
      updateExec.mockResolvedValue(null);
      uploads.deleteImage.mockRejectedValueOnce(new Error('EBUSY'));
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();

      await expect(service.addImages(postId, authorId, files)).rejects.toThrow(
        POST_IMAGE_LIMIT_MESSAGE,
      );
      expect(uploads.deleteImage).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
      logError.mockRestore();
    });

    it('deletes the saved files when the update fails', async () => {
      const { updateExec, uploads, service } = setup();
      updateExec.mockRejectedValue(new Error('database down'));

      await expect(service.addImages(postId, authorId, files)).rejects.toThrow(
        'database down',
      );
      expect(uploads.deleteImage).toHaveBeenCalledTimes(2);
    });

    it('refuses another user with 403 and a missing post with 404, saving nothing', async () => {
      const { findByIdExec, uploads, service } = setup();

      await expect(
        service.addImages(postId, otherId, files),
      ).rejects.toBeInstanceOf(ForbiddenException);
      findByIdExec.mockResolvedValue(null);
      await expect(
        service.addImages(postId, authorId, files),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(uploads.saveImages).not.toHaveBeenCalled();
    });
  });

  describe('removeImage', () => {
    it('pulls the name from the post in one update, then deletes the file', async () => {
      const { posts, updateExec, uploads, service } = setup(['a.png', 'b.png']);
      updateExec.mockResolvedValue(stored(['b.png']));

      const post = await service.removeImage(postId, 'a.png', authorId);

      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(postId), images: 'a.png' },
        { $pull: { images: 'a.png' } },
        { returnDocument: 'after' },
      );
      expect(uploads.deleteImage).toHaveBeenCalledWith('a.png');
      expect(post.images).toEqual(['b.png']);
    });

    it('answers 404 for an image the post does not have, and deletes no file', async () => {
      const { updateExec, uploads, service } = setup(['a.png']);
      updateExec.mockResolvedValue(null);

      await expect(
        service.removeImage(postId, 'someone-else.png', authorId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });

    it('refuses another user with 403 and deletes nothing', async () => {
      const { posts, uploads, service } = setup(['a.png']);

      await expect(
        service.removeImage(postId, 'a.png', otherId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(posts.findOneAndUpdate).not.toHaveBeenCalled();
      expect(uploads.deleteImage).not.toHaveBeenCalled();
    });
  });
});
