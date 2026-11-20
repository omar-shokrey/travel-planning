import { StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ItineraryPdfController } from './itinerary-pdf.controller';
import type { ItineraryPdfService } from './itinerary-pdf.service';

/** The metadata keys of the Swagger decorators, as the other controller specs read them. */
const API_RESPONSE = 'swagger/apiResponse';
const API_PRODUCES = 'swagger/apiProduces';

describe('ItineraryPdfController (ITN-28)', () => {
  const userId = '6740f1c2a4b5c6d7e8f90123';
  const itineraryId = '6740f1c2a4b5c6d7e8f90789';
  const pdf = Buffer.from('%PDF-1.3 test');

  function setup() {
    const itineraryPdf = {
      export: jest
        .fn()
        .mockResolvedValue({ filename: 'ten-days-in-egypt.pdf', pdf }),
    };
    const controller = new ItineraryPdfController(
      itineraryPdf as unknown as ItineraryPdfService,
    );
    return { itineraryPdf, controller };
  }

  it('gives the service the id and the logged-in user', async () => {
    const { itineraryPdf, controller } = setup();

    await controller.exportPdf(itineraryId, userId);

    expect(itineraryPdf.export).toHaveBeenCalledWith(itineraryId, userId);
  });

  it('answers the PDF as an attachment with its type, name and length', async () => {
    const { controller } = setup();

    const file = await controller.exportPdf(itineraryId, userId);

    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders()).toEqual({
      type: 'application/pdf',
      disposition: 'attachment; filename="ten-days-in-egypt.pdf"',
      length: pdf.length,
    });
  });

  it('is for registered users only', () => {
    const reflector = new Reflector();
    const handler = ItineraryPdfController.prototype.exportPdf;

    expect(
      reflector.getAllAndOverride(IS_PUBLIC_KEY, [
        handler,
        ItineraryPdfController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride(ROLES_KEY, [handler, ItineraryPdfController]),
    ).toEqual([Role.User]);
  });

  it('documents a binary PDF and the 400, 403 and 404 answers in Swagger', () => {
    const handler = ItineraryPdfController.prototype.exportPdf;
    const responses = Reflect.getMetadata(API_RESPONSE, handler) as Record<
      string,
      { schema?: unknown }
    >;

    expect(Reflect.getMetadata(API_PRODUCES, handler)).toEqual([
      'application/pdf',
    ]);
    expect(Object.keys(responses).sort()).toEqual(['200', '400', '403', '404']);
    expect(responses['200'].schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    // 401 is documented on the class, for every route of the controller.
    expect(
      Object.keys(
        Reflect.getMetadata(API_RESPONSE, ItineraryPdfController) as object,
      ),
    ).toEqual(['401']);
  });
});
