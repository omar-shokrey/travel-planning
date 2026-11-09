import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SeedModule } from './seed.module';
import { SeedService } from './seed.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    abortOnError: false,
  });
  try {
    await app
      .get(SeedService)
      .run({ dryRun: process.argv.includes('--dry-run') });
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  new Logger('Seed').error(`Seed failed: ${reason}`);
  process.exitCode = 1;
});
