import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { COMMENT_BODY_MAX } from '../blog.constants';
import { UpdateCommentDto } from './update-comment.dto';

const check = async (input: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateCommentDto, input);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    fields: errors.map((error) => error.property),
    messages: errors.flatMap((error) => Object.values(error.constraints ?? {})),
  };
};

describe('UpdateCommentDto (BLG-07)', () => {
  it('accepts a new text and removes the spaces around it', async () => {
    const { dto, messages } = await check({ body: '  Edited text  ' });

    expect(messages).toEqual([]);
    expect(dto.body).toBe('Edited text');
  });

  it('accepts a text of exactly 500 characters', async () => {
    expect(
      (await check({ body: 'a'.repeat(COMMENT_BODY_MAX) })).messages,
    ).toEqual([]);
  });

  it('rejects a text of 501 characters', async () => {
    expect(
      (await check({ body: 'a'.repeat(COMMENT_BODY_MAX + 1) })).messages,
    ).toEqual([`body must be at most ${COMMENT_BODY_MAX} characters`]);
  });

  it('requires the text, because an edit without it changes nothing', async () => {
    expect((await check({})).fields).toEqual(['body']);
    expect((await check({ body: '   ' })).messages).toContain(
      'body must not be empty',
    );
  });

  it('rejects a text that is not text', async () => {
    expect((await check({ body: 42 })).messages).toContain('body must be text');
  });

  it('rejects a field the client may not set', async () => {
    expect(
      (await check({ body: 'Hi', authorId: 'x', postId: 'y' })).fields,
    ).toEqual(['authorId', 'postId']);
  });
});
