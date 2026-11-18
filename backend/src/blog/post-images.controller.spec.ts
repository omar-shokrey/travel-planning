import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PostImagesController } from './post-images.controller';
import type { PostImagesService } from './post-images.service';

const postId = '6740f1c2a4b5c6d7e8f90abc';
const userId = '6740f1c2a4b5c6d7e8f90001';

describe('PostImagesController (BLG-10)', () => {
  const post = { id: postId, images: [] };
  const service = {
    addImages: jest.fn().mockResolvedValue(post),
    removeImage: jest.fn().mockResolvedValue(post),
  };
  const controller = new PostImagesController(
    service as unknown as PostImagesService,
  );

  it('gives the service the post id, the logged-in user and the files', async () => {
    const files = [{ originalname: 'a.png', buffer: Buffer.from('a') }];

    await expect(controller.addImages(postId, userId, files)).resolves.toBe(
      post,
    );
    expect(service.addImages).toHaveBeenCalledWith(postId, userId, files);
  });

  it('gives the service the post id, the image name and the logged-in user', async () => {
    await expect(controller.removeImage(postId, 'a.png', userId)).resolves.toBe(
      post,
    );
    expect(service.removeImage).toHaveBeenCalledWith(postId, 'a.png', userId);
  });

  it('needs a login and the user role on both routes', () => {
    const reflector = new Reflector();
    for (const handler of [
      PostImagesController.prototype.addImages,
      PostImagesController.prototype.removeImage,
    ]) {
      expect(reflector.get(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(reflector.get(ROLES_KEY, handler)).toEqual([Role.User]);
    }
  });
});
