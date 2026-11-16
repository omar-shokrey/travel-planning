import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import { ProviderType } from '../common/enums/provider-type.enum';
import type { StoredImage } from '../uploads/uploads.types';
import type { UploadsService } from '../uploads/uploads.service';
import type { UsersService } from '../users/users.service';
import { AirlineResponseDto } from './dto/airline-response.dto';
import { Airline, type AirlineDocument } from './models/airline.schema';
import { AirlinesService } from './airlines.service';

const AIRLINE_ID = '6740f1c2a4b5c6d7e8f90123';
const MODERATOR_ID = '6740f1c2a4b5c6d7e8f90124';
const OTHER_AIRLINE_ID = '6740f1c2a4b5c6d7e8f90125';
const LOGO_FILENAME = 'new-logo.png';
const OLD_LOGO_FILENAME = 'old-logo.png';

const uploadedLogo = {
  originalname: 'logo.png',
  buffer: Buffer.from('image data'),
};

const storedLogo: StoredImage = {
  filename: LOGO_FILENAME,
  url: `/api/uploads/${LOGO_FILENAME}`,
  mimeType: 'image/png',
  size: uploadedLogo.buffer.length,
};

function airlineDocument(changes: Partial<Airline> = {}): AirlineDocument {
  return {
    _id: new Types.ObjectId(AIRLINE_ID),
    name: 'EgyptAir',
    code: 'MS',
    logo: LOGO_FILENAME,
    active: true,
    createdAt: new Date('2026-11-05T11:00:00.000Z'),
    updatedAt: new Date('2026-11-06T12:00:00.000Z'),
    ...changes,
  } as unknown as AirlineDocument;
}

function setup(
  options: {
    existing?: { _id: Types.ObjectId } | null;
    airline?: AirlineDocument;
    updatedAirline?: AirlineDocument | null;
    assignedAirlineId?: string;
  } = {},
) {
  const airline = options.airline ?? airlineDocument();
  const updatedAirline = options.updatedAirline ?? airlineDocument();
  const findByIdExec = jest.fn().mockResolvedValue(airline);
  const updateExec = jest.fn().mockResolvedValue(updatedAirline);
  const model = {
    exists: jest.fn().mockResolvedValue(options.existing ?? null),
    create: jest.fn().mockResolvedValue(airline),
    findById: jest.fn(() => ({ exec: findByIdExec })),
    findByIdAndUpdate: jest.fn(() => ({ exec: updateExec })),
  };
  const uploadsService = {
    assertWithinLimit: jest.fn(),
    saveImage: jest.fn().mockResolvedValue(storedLogo),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  const usersService = {
    findEntityById: jest.fn().mockResolvedValue({
      assignment: {
        providerType: ProviderType.Airline,
        providerId: new Types.ObjectId(options.assignedAirlineId ?? AIRLINE_ID),
      },
    }),
  };

  const service = new AirlinesService(
    model as unknown as Model<Airline>,
    uploadsService as unknown as UploadsService,
    usersService as unknown as UsersService,
  );

  return {
    findByIdExec,
    model,
    service,
    updateExec,
    uploadsService,
    usersService,
  };
}

describe('AirlinesService', () => {
  describe('create (FLT-01)', () => {
    it('saves the logo filename and returns the mapped profile', async () => {
      const { model, service, uploadsService } = setup();

      const response = await service.create(
        { name: 'EgyptAir', code: 'MS' },
        uploadedLogo,
      );

      expect(uploadsService.saveImage).toHaveBeenCalledWith(uploadedLogo);
      expect(model.create).toHaveBeenCalledWith({
        name: 'EgyptAir',
        code: 'MS',
        logo: LOGO_FILENAME,
      });
      expect(response).toEqual<AirlineResponseDto>({
        id: AIRLINE_ID,
        name: 'EgyptAir',
        code: 'MS',
        logo: LOGO_FILENAME,
        logoUrl: `/api/uploads/${LOGO_FILENAME}`,
        active: true,
        createdAt: '2026-11-05T11:00:00.000Z',
        updatedAt: '2026-11-06T12:00:00.000Z',
      });
    });

    it('stores the airline code in uppercase', async () => {
      const { model, service } = setup();

      await service.create({ name: 'EgyptAir', code: 'ms' }, uploadedLogo);

      expect(model.exists).toHaveBeenCalledWith({ code: 'MS' });
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'MS' }),
      );
    });

    it('returns 409 for an existing code without uploading an unused logo', async () => {
      const { model, service, uploadsService } = setup({
        existing: { _id: new Types.ObjectId(AIRLINE_ID) },
      });

      const error = await service
        .create({ name: 'EgyptAir', code: 'MS' }, uploadedLogo)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      if (error instanceof ConflictException) {
        expect(error.getStatus()).toBe(409);
      }
      expect(uploadsService.saveImage).not.toHaveBeenCalled();
      expect(uploadsService.deleteImage).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('returns 409 and deletes the uploaded logo on a database duplicate-key error', async () => {
      const { model, service, uploadsService } = setup();
      const duplicateKey = Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
      });
      model.create.mockRejectedValueOnce(duplicateKey);

      const error = await service
        .create({ name: 'EgyptAir', code: 'MS' }, uploadedLogo)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      if (error instanceof ConflictException) {
        expect(error.getStatus()).toBe(409);
      }
      expect(uploadsService.deleteImage).toHaveBeenCalledWith(LOGO_FILENAME);
    });
  });

  describe('findById', () => {
    it('returns 404 when the airline does not exist', async () => {
      const { findByIdExec, service } = setup();
      findByIdExec.mockResolvedValueOnce(null);

      await expect(service.findById(AIRLINE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update (FLT-01)', () => {
    it('allows the moderator assigned to the airline to update it', async () => {
      const updatedAirline = airlineDocument({ name: 'EgyptAir Updated' });
      const { model, service, usersService } = setup({ updatedAirline });

      const response = await service.update(AIRLINE_ID, MODERATOR_ID, {
        name: 'EgyptAir Updated',
      });

      expect(usersService.findEntityById).toHaveBeenCalledWith(MODERATOR_ID);
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
        AIRLINE_ID,
        { name: 'EgyptAir Updated' },
        { returnDocument: 'after', runValidators: true },
      );
      expect(response.name).toBe('EgyptAir Updated');
      expect(response).not.toHaveProperty('_id');
    });

    it('returns 403 when the moderator is assigned to another airline', async () => {
      const { model, service, uploadsService } = setup({
        assignedAirlineId: OTHER_AIRLINE_ID,
      });

      await expect(
        service.update(AIRLINE_ID, MODERATOR_ID, { name: 'Changed' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(uploadsService.saveImage).not.toHaveBeenCalled();
    });

    it('deletes the old logo after successful replacement and returns the new logo', async () => {
      const oldAirline = airlineDocument({ logo: OLD_LOGO_FILENAME });
      const updatedAirline = airlineDocument({ logo: LOGO_FILENAME });
      const { service, uploadsService } = setup({
        airline: oldAirline,
        updatedAirline,
      });

      const response = await service.update(
        AIRLINE_ID,
        MODERATOR_ID,
        {},
        uploadedLogo,
      );

      expect(response.logo).toBe(LOGO_FILENAME);
      expect(response.logoUrl).toBe(`/api/uploads/${LOGO_FILENAME}`);
      expect(uploadsService.deleteImage).toHaveBeenCalledWith(
        OLD_LOGO_FILENAME,
      );
      expect(uploadsService.deleteImage).not.toHaveBeenCalledWith(
        LOGO_FILENAME,
      );
    });

    it('deletes the newly uploaded logo when the database update fails', async () => {
      const { service, updateExec, uploadsService } = setup();
      updateExec.mockRejectedValueOnce(new Error('database update failed'));

      await expect(
        service.update(AIRLINE_ID, MODERATOR_ID, {}, uploadedLogo),
      ).rejects.toThrow('database update failed');
      expect(uploadsService.deleteImage).toHaveBeenCalledWith(LOGO_FILENAME);
    });
  });
});
