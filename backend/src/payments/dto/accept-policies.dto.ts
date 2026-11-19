import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { POLICIES_MUST_BE_ACCEPTED_MESSAGE } from '../payments.constants';

/**
 * PAY-02: the acceptance checkbox. It must be sent explicitly as `true`, like
 * the consent of ACC-01: a missing or `false` value is 400, so a request that
 * forgot the checkbox never counts as an acceptance.
 */
export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description:
      "The user accepts the provider's policies shown by GET .../policies. Only `true` is accepted.",
  })
  @Equals(true, { message: POLICIES_MUST_BE_ACCEPTED_MESSAGE })
  accepted: boolean;
}
