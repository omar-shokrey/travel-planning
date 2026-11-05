import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { IsInt, IsUrl, Max, Min, validateSync } from 'class-validator';

/**
 * The environment variables the code reads, checked once at startup. A wrong
 * value stops the app with a clear message instead of failing later.
 *
 * Add a variable here when a feature starts using it. The defaults suit local
 * development and let CI run without a .env file; copy .env.example to
 * backend/.env to change them.
 */
export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  /** Origin of the frontend. CORS allows it, with cookies. */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  FRONTEND_URL: string = 'http://localhost:3000';
}

/** Passed to ConfigModule as `validate`. Returns the checked values or throws. */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config);
  const errors = validateSync(validated);
  if (errors.length > 0) {
    const problems = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new Error(
      `Invalid environment variables:\n- ${problems.join('\n- ')}\nFix backend/.env (see .env.example).`,
    );
  }
  return validated;
}
