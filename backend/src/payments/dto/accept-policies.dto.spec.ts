import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import type { FieldError } from '../../common/interfaces/error-response.interface';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { AcceptPoliciesDto } from './accept-policies.dto';

// The same options as the global pipe in app.setup.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: AcceptPoliciesDto,
};

async function errorsOf(body: unknown): Promise<FieldError[]> {
  try {
    await pipe.transform(body, metadata);
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    return (error.getResponse() as { errors: FieldError[] }).errors;
  }
}

const MUST_ACCEPT = 'You must accept the policies to continue';

describe('AcceptPoliciesDto (PAY-02)', () => {
  it('accepts { accepted: true }', async () => {
    expect(await errorsOf({ accepted: true })).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['false', { accepted: false }],
    ['the text "true"', { accepted: 'true' }],
    ['null', { accepted: null }],
  ])('refuses accepted %s', async (_label, body) => {
    expect(await errorsOf(body)).toEqual([
      { field: 'accepted', messages: [MUST_ACCEPT] },
    ]);
  });

  it('refuses any other field', async () => {
    expect(
      await errorsOf({ accepted: true, policyAcceptedAt: '2026-01-01' }),
    ).toEqual([
      {
        field: 'policyAcceptedAt',
        messages: ['property policyAcceptedAt should not exist'],
      },
    ]);
  });
});
