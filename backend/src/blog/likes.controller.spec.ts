import { LikesController } from './likes.controller';
import type { LikesService } from './likes.service';

const POST_ID = '6740a1b2c3d4e5f601234560';
const USER_ID = '6740a1b2c3d4e5f601234561';

describe('LikesController', () => {
  const setup = () => {
    const service = { like: jest.fn(), unlike: jest.fn() };
    const controller = new LikesController(service as unknown as LikesService);
    return { controller, service };
  };

  it('likes the post for the logged-in user', async () => {
    const { controller, service } = setup();
    const state = { postId: POST_ID, liked: true, likeCount: 1 };
    service.like.mockResolvedValue(state);

    expect(await controller.like(POST_ID, USER_ID)).toBe(state);
    expect(service.like).toHaveBeenCalledWith(POST_ID, USER_ID);
  });

  it('removes the like of the logged-in user', async () => {
    const { controller, service } = setup();
    const state = { postId: POST_ID, liked: false, likeCount: 0 };
    service.unlike.mockResolvedValue(state);

    expect(await controller.unlike(POST_ID, USER_ID)).toBe(state);
    expect(service.unlike).toHaveBeenCalledWith(POST_ID, USER_ID);
  });
});
