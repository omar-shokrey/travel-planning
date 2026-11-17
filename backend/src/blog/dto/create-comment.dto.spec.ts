import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMMENT_BODY_MAX } from '../blog.constants';
import { CreateCommentDto } from './create-comment.dto';

const check = async (body: unknown) => {
  const dto = plainToInstance(CreateCommentDto, { body });
  const errors = await validate(dto);
  return {
    dto,
    messages: errors.flatMap((e) => Object.values(e.constraints!)),
  };
};

describe('CreateCommentDto (BLG-05)', () => {
  it('accepts a comment and removes the spaces around it', async () => {
    const { dto, messages } = await check('  Great tips!  ');

    expect(messages).toEqual([]);
    expect(dto.body).toBe('Great tips!');
  });

  it('accepts a comment of exactly 500 characters', async () => {
    const { messages } = await check('a'.repeat(COMMENT_BODY_MAX));

    expect(messages).toEqual([]);
  });

  it('rejects a comment of 501 characters', async () => {
    const { messages } = await check('a'.repeat(COMMENT_BODY_MAX + 1));

    expect(messages).toEqual(['body must be at most 500 characters']);
  });

  it('rejects an empty comment', async () => {
    const { messages } = await check('');

    expect(messages).toContain('body must not be empty');
  });

  it('rejects a comment of spaces only', async () => {
    const { messages } = await check('     ');

    expect(messages).toContain('body must not be empty');
  });

  it('rejects a missing comment', async () => {
    const { messages } = await check(undefined);

    expect(messages).toContain('body must not be empty');
  });

  it('rejects a comment that is not text', async () => {
    const { messages } = await check(42);

    expect(messages).toContain('body must be text');
  });
});
