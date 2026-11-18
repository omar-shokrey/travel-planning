import { applyDecorators } from '@nestjs/common';
import {
  IsISO8601,
  Matches,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { ROOM_DATE_ONLY_PATTERN } from '../hotels.constants';

/** A real calendar date written as `YYYY-MM-DD`, never a time. */
export const IsDateOnly = (name: string): PropertyDecorator =>
  applyDecorators(
    Matches(ROOM_DATE_ONLY_PATTERN, {
      message: `${name} must be a date in the form YYYY-MM-DD`,
    }),
    IsISO8601(
      { strict: true },
      { message: `${name} must be a real calendar date` },
    ),
  );

/**
 * The date is earlier than the date in `field` of the same object. Two
 * `YYYY-MM-DD` strings compare correctly as plain text.
 */
export const IsBeforeDate = (field: string): PropertyDecorator =>
  ValidateBy({
    name: 'isBeforeDate',
    constraints: [field],
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean => {
        const other = (args?.object as Record<string, unknown> | undefined)?.[
          field
        ];
        return (
          typeof value === 'string' &&
          typeof other === 'string' &&
          value < other
        );
      },
      defaultMessage: (args?: ValidationArguments): string =>
        `${args?.property ?? 'the date'} must be earlier than ${field}`,
    },
  });
