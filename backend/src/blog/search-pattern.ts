/** Escapes the characters a regular expression gives a meaning to, so a keyword is plain text. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A case-insensitive "contains" condition for a keyword (BLG-09). The
 * `$regex` string form is used, not a RegExp object, as in
 * `UsersService.listAccounts`: our e2e runs against Atlas answered it
 * reliably inside `$or`.
 */
export function containsKeyword(keyword: string): {
  $regex: string;
  $options: string;
} {
  return { $regex: escapeRegExp(keyword), $options: 'i' };
}
