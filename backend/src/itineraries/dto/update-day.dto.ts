import { PartialType } from '@nestjs/swagger';
import { AddDayDto } from './add-day.dto';

/** ITN-05: edit the city or the notes of a day. Send only what changes. */
export class UpdateDayDto extends PartialType(AddDayDto) {}
