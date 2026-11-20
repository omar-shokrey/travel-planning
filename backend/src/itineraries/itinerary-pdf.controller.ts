import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ItineraryPdfService } from './itinerary-pdf.service';

/**
 * ITN-28 (bonus): the PDF of an itinerary, under
 * `/api/itineraries/:id/pdf`. Registered after the public itinerary
 * controller in the module, so the routes under `/api/itineraries/public/`
 * are matched first, as before.
 */
@ApiTags('Itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Not logged in' })
@Roles(Role.User)
@Controller('itineraries')
export class ItineraryPdfController {
  constructor(private readonly itineraryPdf: ItineraryPdfService) {}

  @Get(':id/pdf')
  @ApiOperation({
    summary: 'Export your itinerary as a PDF (bonus)',
    description:
      'ITN-28. Downloads your own itinerary as an A4 PDF, to keep or to print from the browser: the title, countries, start date, number of days and visibility; every day with its date, city, notes, activities, budget entries, transport costs and linked bookings (ITN-27); the city groups with their subtotals; and the budget summary by category with the total, converted to your currency exactly as `GET /api/itineraries/{id}/budget-summary` (ITN-18), with a note for currencies that have no rate. The same checks as `GET /api/itineraries/{id}`: private, public and hidden itineraries are all yours to export. Nothing is changed. The built-in PDF fonts print only Western European letters: other characters (Arabic, emoji...) appear as "?" in the PDF, while the data itself is unchanged.',
  })
  @ApiParam({ name: 'id', description: 'Itinerary id' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description:
      'The PDF, as an attachment named after the title (ASCII letters and digits, `itinerary.pdf` when none are left)',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'The id is not a valid id' })
  @ApiForbiddenResponse({
    description:
      'The itinerary belongs to another user, or the caller is not a registered user (administrators and moderators cannot use itineraries)',
  })
  @ApiNotFoundResponse({ description: 'No itinerary has this id' })
  async exportPdf(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.itineraryPdf.export(id, userId);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: pdf.length,
    });
  }
}
