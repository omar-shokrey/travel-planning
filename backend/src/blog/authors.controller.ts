import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthorsService } from './authors.service';
import { AuthorPageQueryDto } from './dto/author-page-query.dto';
import { AuthorPageResponseDto } from './dto/author-page-response.dto';

@ApiTags('Blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authors: AuthorsService) {}

  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Show the public page of an author (BLG-12)',
    description:
      "Open to guests. The author's name, join date, published posts (newest first) and public itineraries (most recently updated first). Each list is paginated on its own (GEN-05): `postsPage` and `postsLimit`, `itinerariesPage` and `itinerariesLimit`, 10 per page by default, at most 50. Drafts, hidden posts and private or hidden itineraries are never shown. An empty list is `items: []`. An unknown id, an administrator, a moderator and a deactivated account all answer 404.",
  })
  @ApiOkResponse({ type: AuthorPageResponseDto })
  @ApiBadRequestResponse({
    description:
      'The id is not a valid id, a page or page size is invalid (page size at most 50), or the query has a parameter that is not allowed',
  })
  @ApiNotFoundResponse({ description: 'Author not found' })
  findPage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: AuthorPageQueryDto,
  ): Promise<AuthorPageResponseDto> {
    return this.authors.findPage(id, query);
  }
}
