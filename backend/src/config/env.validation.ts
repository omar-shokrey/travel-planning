import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  isEmail,
  isFQDN,
  isIP,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  validateSync,
} from 'class-validator';

/** Reads "true" and "false" from the environment. Anything else fails IsBoolean. */
const toBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * A mail sender: a plain address (`no-reply@example.com`) or a display name
 * and an address in brackets (`Travel Platform <no-reply@example.com>`); a
 * name is required before the brackets. The name starts with a letter or a
 * digit and holds only letters, digits, spaces and `. ' & _ -`: no comma,
 * colon, quote, bracket, control character or line break, so the value is
 * always exactly one sender and can never add a recipient or a mail header.
 */
const MAIL_SENDER =
  /^(?:[\p{L}\p{N}][\p{L}\p{N} .'&_-]*?\s*<([^<>\s]+)>|([^<>\s]+))$/u;

export function isMailSender(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = MAIL_SENDER.exec(value);
  const address = match?.[1] ?? match?.[2];
  return address !== undefined && isEmail(address);
}

/**
 * An SMTP host: a host name (`smtp.example.com`, `localhost`, a container
 * name such as `mailpit` or `mail_pit`) or an IPv4 or IPv6 address.
 */
export function isSmtpHost(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (isFQDN(value, { require_tld: false, allow_underscores: true }) ||
      isIP(value))
  );
}

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

  /** Folder for uploaded images (GEN-08). Relative to backend/ unless absolute. */
  @IsString()
  @IsNotEmpty()
  UPLOADS_DIR: string = 'uploads';

  @Matches(/^mongodb(\+srv)?:\/\/\S+$/, {
    message: 'MONGODB_URI must start with mongodb:// or mongodb+srv://',
  })
  MONGODB_URI: string;

  /** Minutes an access token, and the cookie that holds it, stays valid. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  ACCESS_TOKEN_MINUTES: number = 10;

  /** Minutes without an authenticated request before the session expires (ACC-06). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  SESSION_INACTIVITY_MINUTES: number = 30;

  /** Send the authentication cookies over HTTPS only (ACC-19). */
  @Transform(toBoolean)
  @IsBoolean()
  COOKIE_SECURE: boolean = true;

  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' = 'lax';

  /**
   * FXRatesAPI key for the daily exchange rates (ITN-18). It may stay empty:
   * the app then starts and uses the rates already cached in the database.
   */
  @IsString()
  FXRATES_API_KEY: string = '';

  /** FXRatesAPI address. Tests point it at a local fake server. */
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  FXRATES_API_URL: string = 'https://api.fxratesapi.com';

  /**
   * Stripe secret key (PAY-01). It may stay empty: the app then starts and
   * every payment route answers 503. Only a test-mode key is accepted
   * (`sk_test_` or a restricted `rk_test_`): the platform never charges real
   * money, and a live key stops the app at startup.
   */
  @Matches(/^((sk|rk)_test_\S+)?$/, {
    message:
      'STRIPE_SECRET_KEY must be empty or a Stripe test key (starts with sk_test_ or rk_test_)',
  })
  STRIPE_SECRET_KEY: string = '';

  /**
   * Signing secret of the Stripe webhook (PAY-01), from `stripe listen`
   * (starts with `whsec_`). It may stay empty: the webhook then answers 503.
   */
  @Matches(/^(whsec_\S+)?$/, {
    message:
      'STRIPE_WEBHOOK_SECRET must be empty or a Stripe signing secret (starts with whsec_)',
  })
  STRIPE_WEBHOOK_SECRET: string = '';

  /**
   * SMTP server for the email notifications (GEN-01-B), a host name or an IP
   * address. It may stay empty: email is then switched off, the app starts,
   * nothing is sent and nothing fails. In development use a local test inbox
   * that catches every mail without sending it (see .env.example).
   */
  @ValidateIf((env: EnvironmentVariables) => env.SMTP_HOST !== '')
  @ValidateBy({
    name: 'isSmtpHost',
    validator: {
      validate: isSmtpHost,
      defaultMessage: () =>
        'SMTP_HOST must be empty or a host name or an IP address',
    },
  })
  SMTP_HOST: string = '';

  /** SMTP port (GEN-01-B). 1025 is the port of a local test inbox such as Mailpit. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  SMTP_PORT: number = 1025;

  /**
   * Use TLS from the first byte (GEN-01-B), usually with port 465. False
   * opens a plain connection first (ports 25, 587 or 1025).
   */
  @Transform(toBoolean)
  @IsBoolean()
  SMTP_SECURE: boolean = false;

  /**
   * SMTP login name (GEN-01-B). It may stay empty for a server that needs no
   * login, such as a local test inbox. Never logged and never put in an error
   * message.
   */
  @IsString()
  SMTP_USER: string = '';

  /**
   * SMTP password (GEN-01-B). A secret: never logged and never put in an
   * error message. It may stay empty for a server that needs no login.
   */
  @IsString()
  SMTP_PASSWORD: string = '';

  /**
   * Sender of every email (GEN-01-B): `Name <address@host>` or a plain
   * address (see isMailSender). Checked only when SMTP_HOST is set, since
   * nothing is sent otherwise.
   */
  @ValidateIf((env: EnvironmentVariables) => env.SMTP_HOST !== '')
  @ValidateBy({
    name: 'isMailSender',
    validator: {
      validate: isMailSender,
      defaultMessage: () =>
        'MAIL_FROM must be an email address or "Name <address@host>" when SMTP_HOST is set',
    },
  })
  MAIL_FROM: string = 'Travel Platform <no-reply@travel-platform.local>';
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
