import { BadRequestException, type ValidationError } from '@nestjs/common';
import type { FieldError } from '../interfaces/error-response.interface';

/** Turns class-validator's nested errors into one flat list with a path per field. */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FieldError[] {
  const result: FieldError[] = [];
  for (const error of errors) {
    const field = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    if (error.constraints) {
      result.push({ field, messages: Object.values(error.constraints) });
    }
    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }
  return result;
}

/** Passed to the global ValidationPipe as `exceptionFactory` (see main.ts). */
export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    errors: flattenValidationErrors(errors),
  });
}
