import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsEmail, Matches, validateSync } from 'class-validator';
import { PASSWORD_PATTERN, PASSWORD_RULE } from '../common/constants/password';
import {
  validateEnv,
  type EnvironmentVariables,
} from '../config/env.validation';

export class SeedEnvironmentVariables {
  @IsEmail({}, { message: 'ADMIN_EMAIL must be a valid email address' })
  ADMIN_EMAIL: string;

  @Matches(PASSWORD_PATTERN, { message: `ADMIN_PASSWORD ${PASSWORD_RULE}` })
  ADMIN_PASSWORD: string;
}

export type SeedEnvironment = EnvironmentVariables & SeedEnvironmentVariables;

export function validateSeedEnv(
  config: Record<string, unknown>,
): SeedEnvironment {
  const app = validateEnv(config);
  const seed = plainToInstance(SeedEnvironmentVariables, {
    ADMIN_EMAIL: config.ADMIN_EMAIL,
    ADMIN_PASSWORD: config.ADMIN_PASSWORD,
  });
  const errors = validateSync(seed);
  if (errors.length > 0) {
    const problems = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new Error(
      `Invalid seed variables:\n- ${problems.join('\n- ')}\nSet them in backend/.env (see .env.example).`,
    );
  }
  return Object.assign(app, seed);
}
