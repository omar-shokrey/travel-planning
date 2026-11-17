import { BadRequestException } from '@nestjs/common';

/**
 * Refuses `null` in an edit, as the hotel edit does (HTL-01). `PartialType`
 * makes every field `@IsOptional()`, which lets `null` through as well as a
 * missing field, so the DTO alone cannot refuse it. The answer is a 400 in the
 * usual validation shape, one entry per field.
 */
export function assertNoNullFields(dto: object): void {
  const fields = Object.entries(dto)
    .filter(([, value]) => value === null)
    .map(([field]) => field)
    .sort();
  if (fields.length > 0) {
    throw new BadRequestException({
      message: 'Validation failed',
      errors: fields.map((field) => ({
        field,
        messages: [`${field} must not be null`],
      })),
    });
  }
}
