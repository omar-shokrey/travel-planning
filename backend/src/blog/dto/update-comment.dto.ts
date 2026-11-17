import { CreateCommentDto } from './create-comment.dto';

/**
 * What a user may send to edit their comment (BLG-07). A comment has only its
 * text, so an edit must carry it: the same rules as for a new comment apply
 * (non-empty, at most 500 characters). A `PartialType` would allow an empty
 * body that changes nothing.
 */
export class UpdateCommentDto extends CreateCommentDto {}
