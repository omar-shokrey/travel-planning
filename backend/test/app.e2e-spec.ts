import { Controller, Get, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp, setupSwagger } from './../src/app.setup';
import { PaginationQueryDto } from './../src/common/dto/pagination-query.dto';

/**
 * Throwaway routes that exercise the global setup. No real route has a query
 * DTO or reads cookies yet.
 */
@Controller('probe')
class ProbeController {
  @Get()
  list(@Query() query: PaginationQueryDto) {
    return { page: query.page, limit: query.limit, skip: query.skip };
  }

  @Get('cookies')
  cookies(@Req() req: { cookies: Record<string, string> }) {
    return req.cookies;
  }
}

describe('App setup (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves routes under the /api prefix only', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
    await request(app.getHttpServer()).get('/health').expect(404);
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('reports that the API and the database are up', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('answers an unknown route with the standard error body', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/nothing-here?x=1')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      path: '/api/nothing-here',
    });
    expect(response.body.message).toEqual(expect.any(String));
  });

  it('applies defaults and converts query values', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe?page=3')
      .expect(200);

    expect(response.body).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it('rejects an invalid query with a message per field', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe?page=0')
      .expect(400);

    expect(response.body.message).toBe('Validation failed');
    expect(response.body.errors).toEqual([
      { field: 'page', messages: [expect.stringContaining('page')] },
    ]);
  });

  it('rejects query parameters it does not know', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe?sort=price')
      .expect(400);

    expect(response.body.errors).toEqual([
      { field: 'sort', messages: [expect.stringContaining('sort')] },
    ]);
  });

  it('reads cookies', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe/cookies')
      .set('Cookie', 'access_token=abc')
      .expect(200);

    expect(response.body).toEqual({ access_token: 'abc' });
  });

  it('sends security headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'cross-origin',
    );
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('lets the frontend call the API with cookies (CORS)', async () => {
    const frontendUrl = app.get(ConfigService).get<string>('FRONTEND_URL');

    const response = await request(app.getHttpServer())
      .options('/api/health')
      .set('Origin', frontendUrl as string)
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(frontendUrl);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('publishes the Swagger document with cookie authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(response.body.info.title).toBe(
      'Travel Planning and Booking Platform API',
    );
    expect(response.body.components.securitySchemes.cookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
    });
  });
});
