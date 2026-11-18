import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { Public } from '../common/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import { AuthorPageResponseDto } from './dto/author-page-response.dto';
import { AuthorsService } from './authors.service';

@ApiTags('Authors')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Public()
  @Get(':id')
  async getAuthorPage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageResponseDto> {
    return this.authorsService.findAuthorPage(new Types.ObjectId(id), query);
  }
}
