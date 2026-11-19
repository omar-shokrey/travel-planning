import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { BlogModule } from './blog.module';
import { PostPageQueryDto } from './dto/post-page-query.dto';
import type { PostPageResponseDto } from './dto/post-page-response.dto';
import { PostPageController } from './post-page.controller';
import type { PostPageService } from './post-page.service';
import { PostsController } from './posts.controller';

const POST_ID = '6740f1c2a4b5c6d7e8f90abc';

const page = { id: POST_ID } as PostPageResponseDto;

function setup() {
  const service = { findPage: jest.fn().mockResolvedValue(page) };
  const controller = new PostPageController(
    service as unknown as PostPageService,
  );
  return { service, controller };
}

describe('PostPageController (BLG-02)', () => {
  it('returns what the service returns, for the id and the query', async () => {
    const { service, controller } = setup();
    const query = Object.assign(new PostPageQueryDto(), { commentsPage: 2 });

    await expect(controller.findPage(POST_ID, query)).resolves.toBe(page);
    expect(service.findPage).toHaveBeenCalledWith(POST_ID, query);
  });

  it('is open to guests and needs no role', () => {
    const reflector = new Reflector();
    const handler = PostPageController.prototype.findPage;

    expect(reflector.get(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
    expect(reflector.get(ROLES_KEY, PostPageController)).toBeUndefined();
  });

  it('answers GET /posts/:id', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PostPageController)).toBe(
      'posts',
    );
    expect(
      Reflect.getMetadata(PATH_METADATA, PostPageController.prototype.findPage),
    ).toBe(':id');
  });

  it('is registered after PostsController, so GET /posts/mine is matched first', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      BlogModule,
    ) as unknown[];

    expect(controllers).toContain(PostPageController);
    expect(controllers.indexOf(PostsController)).toBeLessThan(
      controllers.indexOf(PostPageController),
    );
  });
});
