import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommentsController } from './comments.controller';
import type { CommentsService } from './comments.service';

const POST_ID = '6740a1b2c3d4e5f601234560';
const USER_ID = '6740a1b2c3d4e5f601234561';
const COMMENT_ID = '6740a1b2c3d4e5f601234563';

describe('CommentsController', () => {
  const setup = () => {
    const service = {
      create: jest.fn(),
      listForPost: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    const controller = new CommentsController(
      service as unknown as CommentsService,
    );
    return { controller, service };
  };

  it('passes the post id, the body and the logged-in user to the service', async () => {
    const { controller, service } = setup();
    const comment = { id: 'comment-1', body: 'Great tips!' };
    service.create.mockResolvedValue(comment);
    const dto = { body: 'Great tips!' };

    expect(await controller.create(POST_ID, dto, USER_ID)).toBe(comment);
    expect(service.create).toHaveBeenCalledWith(POST_ID, dto, USER_ID);
  });

  it('passes the post id and the page query to the service', async () => {
    const { controller, service } = setup();
    const page = { items: [], meta: {} };
    service.listForPost.mockResolvedValue(page);
    const query = new PaginationQueryDto();

    expect(await controller.list(POST_ID, query)).toBe(page);
    expect(service.listForPost).toHaveBeenCalledWith(POST_ID, query);
  });

  it('passes the comment id, the new text and the logged-in user to the service', async () => {
    const { controller, service } = setup();
    const comment = { id: COMMENT_ID, body: 'Even better tips!' };
    service.update.mockResolvedValue(comment);
    const dto = { body: 'Even better tips!' };

    expect(await controller.update(COMMENT_ID, dto, USER_ID)).toBe(comment);
    expect(service.update).toHaveBeenCalledWith(COMMENT_ID, dto, USER_ID);
  });

  it('deletes the comment for the logged-in user and returns nothing', async () => {
    const { controller, service } = setup();
    service.remove.mockResolvedValue(undefined);

    expect(await controller.remove(COMMENT_ID, USER_ID)).toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(COMMENT_ID, USER_ID);
  });
});
