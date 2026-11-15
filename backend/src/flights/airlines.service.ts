import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Airline, AirlineDocument } from './models/airline.schema';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { UploadsService } from '../uploads/uploads.service';
import type { ImageFile } from '../uploads/uploads.types';
import { UsersService } from '../users/users.service';
import { ProviderType } from '../common/enums/provider-type.enum';

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    private readonly uploadsService: UploadsService,
    private readonly usersService: UsersService,
  ) {}

  async create(
    dto: CreateAirlineDto,
    logo: ImageFile | undefined,
  ): Promise<AirlineDocument> {
    const code = dto.code.trim().toUpperCase();

    const existing = await this.airlineModel.exists({ code });

    if (existing) {
      throw new ConflictException('An airline with this code already exists');
    }

    this.uploadsService.assertWithinLimit('airline', 0, 1);

    const storedLogo = await this.uploadsService.saveImage(logo);

    try {
      return await this.airlineModel.create({
        name: dto.name,
        code,
        logo: storedLogo.filename,
      });
    } catch (error) {
      await this.uploadsService.deleteImage(storedLogo.filename);

      if (error instanceof Error && 'code' in error && error.code === 11000) {
        throw new ConflictException('An airline with this code already exists');
      }

      throw error;
    }
  }

  async findById(id: string): Promise<AirlineDocument> {
    const airline = await this.airlineModel.findById(id).exec();

    if (!airline) {
      throw new NotFoundException('Airline not found');
    }

    return airline;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateAirlineDto,
    logo?: ImageFile,
  ): Promise<AirlineDocument> {
    const airline = await this.findById(id);

    const user = await this.usersService.findEntityById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      user.assignment?.providerType !== ProviderType.Airline ||
      user.assignment?.providerId.toString() !== airline._id.toString()
    ) {
      throw new ForbiddenException('You can only edit your assigned airline');
    }

    const code = dto.code?.trim().toUpperCase();

    if (code) {
      const existing = await this.airlineModel.exists({
        code,
        _id: { $ne: airline._id },
      });

      if (existing) {
        throw new ConflictException('An airline with this code already exists');
      }
    }

    let storedLogo:
      Awaited<ReturnType<UploadsService['saveImage']>> | undefined;

    if (logo) {
      this.uploadsService.assertWithinLimit('airline', 0, 1);
      storedLogo = await this.uploadsService.saveImage(logo);
    }

    try {
      const updatedAirline = await this.airlineModel
        .findByIdAndUpdate(
          id,
          {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(code !== undefined && { code }),
            ...(storedLogo && { logo: storedLogo.filename }),
          },
          { new: true, runValidators: true },
        )
        .exec();

      if (!updatedAirline) {
        throw new NotFoundException('Airline not found');
      }

      if (storedLogo) {
        await this.uploadsService.deleteImage(airline.logo);
      }

      return updatedAirline;
    } catch (error) {
      if (storedLogo) {
        await this.uploadsService.deleteImage(storedLogo.filename);
      }

      if (error instanceof Error && 'code' in error && error.code === 11000) {
        throw new ConflictException('An airline with this code already exists');
      }

      throw error;
    }
  }
}
