import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { IMAGE_LIMITS } from '../uploads/uploads.constants';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.types';
import type { PostResponseDto } from './dto/post-response.dto';
import { toPostResponse } from './mappers/post.mapper';
import { BlogPost, type BlogPostDocument } from './models/blog-post.schema';

/** How many images a post may have (GEN-08), and the answer past it. */
const MAX_POST_IMAGES = IMAGE_LIMITS.post.max;
export const POST_IMAGE_LIMIT_MESSAGE = `${IMAGE_LIMITS.post.subject} can have at most ${MAX_POST_IMAGES} ${IMAGE_LIMITS.post.thing}s.`;

/**
 * The images of a post (BLG-10, GEN-08). Only the author adds or removes
 * them, on a draft or a published post. The post keeps the stored file
 * names; the files are served at `/api/uploads/<name>`.
 */
@Injectable()
export class PostImagesService {
  private readonly logger = new Logger(PostImagesService.name);

  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Saves the files, then adds their names to the post in one conditional
   * update that matches only while the post still has room for all of them.
   * Two uploads at the same time can therefore never pass the limit. When
   * the update does not match, or anything fails after the files were
   * saved, the new files are deleted again: no orphan file stays on disk.
   */
  async addImages(
    id: string,
    userId: string,
    files: readonly ImageFile[] | undefined,
  ): Promise<PostResponseDto> {
    const post = await this.findOwnedOrThrow(id, userId);
    const incoming = files?.length ?? 0;
    this.uploads.assertWithinLimit('post', post.images.length, incoming);

    const stored = await this.uploads.saveImages(files);
    const names = stored.map(({ filename }) => filename);
    try {
      const updated = await this.posts
        .findOneAndUpdate(
          {
            _id: post._id,
            // There is room for all of them: the array has no element at
            // the position the first image past the limit would take.
            [`images.${MAX_POST_IMAGES - names.length}`]: { $exists: false },
          },
          { $push: { images: { $each: names } } },
          { returnDocument: 'after' },
        )
        .exec();
      if (!updated) {
        // Another upload took the room in the meantime, or the post is gone.
        if (!(await this.posts.exists({ _id: post._id }))) {
          throw new NotFoundException('Post not found');
        }
        throw new BadRequestException(POST_IMAGE_LIMIT_MESSAGE);
      }
      return toPostResponse(updated);
    } catch (error) {
      await this.deleteSavedFiles(names);
      throw error;
    }
  }

  /** Removes one image from the post, then its file (BLG-10). */
  async removeImage(
    id: string,
    imageId: string,
    userId: string,
  ): Promise<PostResponseDto> {
    const post = await this.findOwnedOrThrow(id, userId);
    const updated = await this.posts
      .findOneAndUpdate(
        { _id: post._id, images: imageId },
        { $pull: { images: imageId } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Post image not found');
    }
    await this.uploads.deleteImage(imageId);
    return toPostResponse(updated);
  }

  /**
   * Deletes the files of an upload that failed. Every file is tried, and a
   * file that cannot be deleted is logged, so the caller still gets the
   * error that made the upload fail (400, 404 or the database error), not a
   * 500 from the cleanup.
   */
  private async deleteSavedFiles(names: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      names.map((name) => this.uploads.deleteImage(name)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          `Could not delete the uploaded file ${names[index]} after a failed upload`,
          result.reason instanceof Error ? result.reason.stack : undefined,
        );
      }
    });
  }

  /** Missing post: 404. Someone else's post: 403. */
  private async findOwnedOrThrow(
    id: string,
    userId: string,
  ): Promise<BlogPostDocument> {
    const post = await this.posts.findById(id).exec();
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.authorId.toString() !== userId) {
      throw new ForbiddenException('You can only change your own posts');
    }
    return post;
  }
}
