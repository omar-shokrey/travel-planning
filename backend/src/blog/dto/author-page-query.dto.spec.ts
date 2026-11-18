import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthorPageQueryDto } from './author-page-query.dto';

describe('AuthorPageQueryDto', () => {
  it('should use the required defaults', () => {
    const dto = plainToInstance(AuthorPageQueryDto, {});

    expect(dto.postsPage).toBe(1);
    expect(dto.postsLimit).toBe(10);
    expect(dto.itinerariesPage).toBe(1);
    expect(dto.itinerariesLimit).toBe(10);
  });

  it('should accept valid pagination values', async () => {
    const dto = plainToInstance(AuthorPageQueryDto, {
      postsPage: '2',
      postsLimit: '20',
      itinerariesPage: '3',
      itinerariesLimit: '5',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.postsPage).toBe(2);
    expect(dto.postsLimit).toBe(20);
    expect(dto.itinerariesPage).toBe(3);
    expect(dto.itinerariesLimit).toBe(5);
  });

  it('should reject page values below 1', async () => {
    const dto = plainToInstance(AuthorPageQueryDto, {
      postsPage: '0',
      itinerariesPage: '0',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
  });

  it('should reject limits above 50', async () => {
    const dto = plainToInstance(AuthorPageQueryDto, {
      postsLimit: '51',
      itinerariesLimit: '51',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
  });

  it('should reject non-integer pagination values', async () => {
    const dto = plainToInstance(AuthorPageQueryDto, {
      postsPage: '1.5',
      itinerariesLimit: '2.5',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
  });
});
