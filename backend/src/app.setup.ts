import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ACCESS_TOKEN_COOKIE } from './common/constants/cookies';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import type { EnvironmentVariables } from './config/env.validation';
import { UPLOADS_URL_PREFIX } from './uploads/uploads.constants';
import { UploadsService } from './uploads/uploads.service';

/**
 * Everything the running app and the e2e tests share, so the tests exercise
 * the real setup: prefix, security headers, cookies, CORS, validation, errors,
 * uploaded images.
 */
export function configureApp(app: NestExpressApplication): void {
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.setGlobalPrefix('api');

  app.use(
    helmet({
      // The frontend runs on another origin and shows images served by this API.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // This API returns JSON, and the default policy can stop Swagger UI from
      // loading over plain http.
      contentSecurityPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
  });

  // Uploaded images (GEN-08) are public: anyone can open one at
  // /api/uploads/<file name>. The name is random, a file never changes under
  // the same name, so browsers may keep it. A missing file falls through to
  // the standard 404 body.
  app.useStaticAssets(app.get(UploadsService).directory, {
    prefix: UPLOADS_URL_PREFIX,
    index: false,
    redirect: false,
    maxAge: '7d',
    immutable: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}

/** Swagger UI at /api/docs and the JSON document at /api/docs-json. */
export function setupSwagger(app: INestApplication): void {
  const options = new DocumentBuilder()
    .setTitle('Travel Planning and Booking Platform API')
    .setDescription(
      'Flights, hotels, itineraries and travel blog. Log in with POST /api/auth/login: the browser keeps the httpOnly cookies and sends them with every request.',
    )
    .setVersion('1.0')
    .addCookieAuth(ACCESS_TOKEN_COOKIE)
    .build();

  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, options),
    { swaggerOptions: { persistAuthorization: true } },
  );
}
