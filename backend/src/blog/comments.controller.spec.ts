import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CommentsController } from './comments.controller';
import type { CommentsService } from './comments.service';

const POST_ID = '6740a1b2c3d4e5f601234560';
const USER_ID = '6740a1b2c3d4e5f601234561';

describe('CommentsController', () => {
  const setup = () => {
    const service = {
      create: jest.fn(),
      listForPost: jest.fn(),
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
});
