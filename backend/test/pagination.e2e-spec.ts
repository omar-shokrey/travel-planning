import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiProperty } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { ApiPaginatedResponse } from './../src/common/decorators/api-paginated-response.decorator';
import { Public } from './../src/common/decorators/public.decorator';
import { PaginationQueryDto } from './../src/common/dto/pagination-query.dto';
import { paginate } from './../src/common/dto/paginated-response.dto';

class ProbeRowDto {
  @ApiProperty({ example: 1 })
  n: number;
}

/**
 * A throwaway list route that is built the way every real list will be: the
 * query DTO, one page cut with `skip` and `limit`, and `paginate`. The number
 * of rows comes from the URL, so the tests can try any size. It reads nothing
 * from the database.
 */
@Public()
@Controller('probe-lists')
class ProbeListController {
  @Get(':rows')
  @ApiPaginatedResponse(ProbeRowDto)
  list(
    @Param('rows', ParseIntPipe) rows: number,
    @Query() query: PaginationQueryDto,
  ) {
    const all = Array.from({ length: rows }, (_, index) => ({ n: index + 1 }));
    return paginate(
      all.slice(query.skip, query.skip + query.limit),
      rows,
      query,
    );
  }
}

/** The part of the Swagger document these tests read. */
interface SwaggerListRoute {
  get: {
    parameters: { name: string; in: string }[];
    responses: Record<
      string,
      {
        content: Record<
          string,
          { schema: { properties: Record<string, unknown> } }
        >;
      }
    >;
  };
}

const numbers = (items: { n: number }[]): number[] =>
  items.map((item) => item.n);

/** GEN-05: every list longer than 10 rows is paginated, 10 rows per page. */
describe('Pagination (e2e, GEN-05)', () => {
  let app: NestExpressApplication;

  const list = (rows: number, query = '') =>
    request(app.getHttpServer()).get(`/api/probe-lists/${rows}${query}`);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeListController],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the first 10 rows of a longer list by default', async () => {
    const response = await list(25).expect(200);

    expect(numbers(response.body.items)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('returns the rows of the page that was asked for', async () => {
    const second = await list(25, '?page=2').expect(200);
    const last = await list(25, '?page=3').expect(200);

    expect(numbers(second.body.items)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(numbers(last.body.items)).toEqual([21, 22, 23, 24, 25]);
    expect(last.body.meta).toEqual({
      page: 3,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('answers a page after the last one with an empty page, not an error', async () => {
    const response = await list(25, '?page=4').expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.meta).toEqual({
      page: 4,
      limit: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [10, 10, 1],
    [11, 10, 2],
  ])(
    'a list of %i rows shows %i rows on page 1 and has %i page(s)',
    async (rows, shown, pages) => {
      const response = await list(rows).expect(200);

      expect(response.body.items).toHaveLength(shown);
      expect(response.body.meta).toMatchObject({
        total: rows,
        totalPages: pages,
      });
    },
  );

  it('puts the 11th row of an 11-row list alone on page 2', async () => {
    const response = await list(11, '?page=2').expect(200);

    expect(numbers(response.body.items)).toEqual([11]);
  });

  it('lets the caller choose a page size up to 50', async () => {
    const five = await list(25, '?limit=5').expect(200);
    const fifty = await list(60, '?limit=50').expect(200);

    expect(five.body.items).toHaveLength(5);
    expect(five.body.meta).toMatchObject({ limit: 5, totalPages: 5 });
    expect(fifty.body.items).toHaveLength(50);
    expect(fifty.body.meta).toMatchObject({ limit: 50, totalPages: 2 });
  });

  it.each([
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
    ['page', 'abc'],
    ['limit', '0'],
    ['limit', '51'],
    ['limit', 'abc'],
    ['size', '5'],
  ])('rejects %s=%s with a message for that field', async (field, value) => {
    const response = await list(25, `?${field}=${value}`).expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(
      (response.body.errors as { field: string }[]).map((error) => error.field),
    ).toEqual([field]);
  });

  it('documents the page parameters and the items and meta body in Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = response.body.paths as Record<string, SwaggerListRoute>;
    const path = Object.keys(paths).find((key) =>
      key.endsWith('/probe-lists/{rows}'),
    );
    const route = paths[path as string].get;
    const parameter = (name: string) =>
      route.parameters.find((candidate) => candidate.name === name);

    expect(parameter('page')).toMatchObject({ in: 'query' });
    expect(parameter('limit')).toMatchObject({ in: 'query' });
    expect(JSON.stringify(parameter('limit'))).toContain('"default":10');
    expect(JSON.stringify(parameter('limit'))).toContain('"maximum":50');
    expect(
      Object.keys(
        route.responses['200'].content['application/json'].schema.properties,
      ),
    ).toEqual(['items', 'meta']);
  });
});
