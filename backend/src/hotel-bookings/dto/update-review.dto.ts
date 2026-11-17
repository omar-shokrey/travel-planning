import { PartialType } from '@nestjs/swagger';
import { CreateReviewDto } from './create-review.dto';

/**
 * HTL-23: edit an own review. Send `rating`, `text` or both; an empty
 * `text` removes the text.
 */
export class UpdateReviewDto extends PartialType(CreateReviewDto) {}
