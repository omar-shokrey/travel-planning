import type { TransformFnParams } from 'class-transformer';

/** Removes the spaces around a text. Anything that is not a text is left for the validators to reject. */
export const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** For emails: "  Sara@Example.COM " and "sara@example.com" are the same account. */
export const trimAndLowercase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
