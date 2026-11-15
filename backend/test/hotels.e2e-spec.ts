import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { configureApp, setupSwagger } from '../src/app.setup';
import { Role } from '../src/common/enums/role.enum';
import { RolesGuard } from '../src/common/guards/roles.guard';
import type { AuthenticatedRequest } from '../src/common/interfaces/authenticated-user.interface';
import { HotelsController } from '../src/hotels/hotels.controller';
import { HotelsService } from '../src/hotels/hotels.service';
import { UploadsService } from '../src/uploads/uploads.service';

class HotelTestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = {
      id: '6740f1c2a4b5c6d7e8f90124',
      role:
        request.header('x-test-role') === Role.User
          ? Role.User
          : request.method === 'POST' && request.path === '/api/hotels'
            ? Role.Admin
            : Role.HotelModerator,
    };
    return true;
  }
}

interface SwaggerOperation {
  requestBody?: {
    content?: Record<
      string,
      { schema?: { properties?: Record<string, unknown> } }
    >;
  };
  responses: Record<string, unknown>;
}

interface HotelsSwaggerDocument {
  paths: Record<string, Record<string, SwaggerOperation>>;
  components: {
    schemas: Record<string, { properties: Record<string, unknown> }>;
  };
}

describe('Hotels API (e2e, HTL-01)', () => {
  let app: NestExpressApplication;
  const hotelsService = {
    create: jest.fn(),
    update: jest.fn(),
    addPhotos: jest.fn(),
    removePhoto: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [HotelsController],
      providers: [
        { provide: HotelsService, useValue: hotelsService },
        {
          provide: ConfigService,
          useValue: {
            get: (name: string) =>
              name === 'FRONTEND_URL' ? 'http://localhost:3000' : undefined,
          },
        },
        { provide: UploadsService, useValue: { directory: tmpdir() } },
        { provide: APP_GUARD, useClass: HotelTestAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validBody = () => ({
    name: 'Cairo Garden Hotel',
    addressLine: '12 Nile Street',
    cityId: 'city_001',
    description: 'A quiet hotel close to the city centre.',
    starClass: 4,
    amenities: ['wifi', 'pool'],
  });

  it('rejects missing and unknown fields before the service runs', async () => {
    const missing = await request(app.getHttpServer())
      .post('/api/hotels')
      .send({})
      .expect(400);
    expect(missing.body.path).toBe('/api/hotels');

    const unknown = await request(app.getHttpServer())
      .post('/api/hotels')
      .send({ ...validBody(), active: false })
      .expect(400);
    expect(unknown.body.errors).toEqual([
      { field: 'active', messages: ['property active should not exist'] },
    ]);
    expect(hotelsService.create).not.toHaveBeenCalled();
  });

  it.each([0, 6, 3.5, '4'])(
    'rejects invalid star class %j before the service runs',
    async (starClass) => {
      await request(app.getHttpServer())
        .post('/api/hotels')
        .send({ ...validBody(), starClass })
        .expect(400);

      expect(hotelsService.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a user role on the administrator route', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .set('x-test-role', Role.User)
      .send(validBody())
      .expect(403);

    expect(hotelsService.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed hotel id before the service runs', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/hotels/not-an-object-id')
      .send({ name: 'Updated name' })
      .expect(400);

    expect(response.body.path).toBe('/api/hotels/not-an-object-id');
    expect(hotelsService.update).not.toHaveBeenCalled();
  });

  it('documents profile and photo routes with request and response schemas', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    const document = response.body as HotelsSwaggerDocument;
    const create = document.paths['/api/hotels'].post;
    const update = document.paths['/api/hotels/{id}'].patch;
    const addPhotos = document.paths['/api/hotels/{id}/photos'].post;
    const removePhoto =
      document.paths['/api/hotels/{id}/photos/{filename}'].delete;

    expect(create.responses).toEqual(
      expect.objectContaining({
        '201': expect.any(Object),
        '400': expect.any(Object),
      }),
    );
    expect(update.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '403': expect.any(Object),
        '404': expect.any(Object),
      }),
    );
    expect(addPhotos.responses).toEqual(
      expect.objectContaining({
        '413': expect.any(Object),
        '415': expect.any(Object),
      }),
    );
    expect(removePhoto.responses['200']).toBeDefined();

    const createSchema =
      create.requestBody?.content?.['application/json']?.schema;
    expect(createSchema).toEqual({
      $ref: '#/components/schemas/CreateHotelDto',
    });
    expect(
      Object.keys(document.components.schemas.CreateHotelDto.properties).sort(),
    ).toEqual([
      'addressLine',
      'amenities',
      'cityId',
      'description',
      'name',
      'starClass',
    ]);
    expect(
      addPhotos.requestBody?.content?.['multipart/form-data']?.schema
        ?.properties,
    ).toEqual({ images: expect.any(Object) });
  });
});
