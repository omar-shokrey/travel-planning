import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsQueryDto } from './list-notifications-query.dto';

const parse = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListNotificationsQueryDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, fields: errors.map((error) => error.property) };
};

describe('ListNotificationsQueryDto', () => {
  it('defaults to page 1 of 10 with no unread filter', async () => {
    const { dto, fields } = await parse({});

    expect(fields).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.unread).toBeUndefined();
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('reads unread=%s as a boolean', async (text, value) => {
    const { dto, fields } = await parse({ unread: text });

    expect(fields).toEqual([]);
    expect(dto.unread).toBe(value);
  });

  it.each(['yes', '1', ''])('rejects unread=%p', async (text) => {
    expect((await parse({ unread: text })).fields).toEqual(['unread']);
  });

  it('rejects a parameter that is not allowed', async () => {
    expect((await parse({ userId: 'someone' })).fields).toEqual(['userId']);
  });
});
