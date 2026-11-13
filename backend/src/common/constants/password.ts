export const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{8,}$/u;

export const PASSWORD_RULE =
  'must be at least 8 characters and include a letter and a digit';

export const PASSWORD_SALT_ROUNDS = 12;
