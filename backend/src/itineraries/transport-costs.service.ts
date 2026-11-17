import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CreateTransportCostDto } from './dto/create-transport-cost.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { assertNoNullFields } from './dto/null-fields';
import type { UpdateTransportCostDto } from './dto/update-transport-cost.dto';
import { ItinerariesService } from './itineraries.service';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import type { ItineraryDay } from './models/itinerary-day.schema';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';
import type { TransportCost } from './models/transport-cost.schema';

/** Where a transport cost sits: its itinerary, its day and the cost itself. */
interface TransportCostLocation {
  itinerary: ItineraryDocument;
  day: ItineraryDay;
  cost: TransportCost;
}

/**
 * ITN-16: transport between cities, booked on one day of the itinerary. Like
 * activities (ITN-10) they are embedded in the itinerary, so every change is a
 * change of the itinerary document.
 */
@Injectable()
export class TransportCostsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  /** ITN-16: add a transport cost to a day of your own itinerary. */
  async add(
    itineraryId: string,
    dto: CreateTransportCostDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
    );
    const day = this.itinerariesService.findDayOrThrow(itinerary, dto.dayId);
    await this.assertValidTrip(dto.fromCityId, dto.toCityId);
    await this.itinerariesService.assertCurrencySupported(dto.currency);

    day.transportCosts.push({
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amount: dto.amount,
      currency: dto.currency,
    } as TransportCost);
    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /**
   * ITN-16: edit a transport cost of your own itinerary. Send only what
   * changes; a new `dayId` moves it to that day of the same itinerary.
   */
  async update(
    costId: string,
    dto: UpdateTransportCostDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    assertNoNullFields(dto);
    const { itinerary, day, cost } = await this.findOwnedCostOrThrow(
      costId,
      userId,
    );

    const target =
      dto.dayId !== undefined
        ? this.itinerariesService.findDayOrThrow(itinerary, dto.dayId)
        : day;
    if (dto.fromCityId !== undefined || dto.toCityId !== undefined) {
      await this.assertValidTrip(
        dto.fromCityId ?? cost.fromCityId,
        dto.toCityId ?? cost.toCityId,
      );
    }
    if (dto.currency !== undefined) {
      await this.itinerariesService.assertCurrencySupported(dto.currency);
    }

    if (dto.mode !== undefined) cost.mode = dto.mode;
    if (dto.fromCityId !== undefined) cost.fromCityId = dto.fromCityId;
    if (dto.toCityId !== undefined) cost.toCityId = dto.toCityId;
    if (dto.amount !== undefined) cost.amount = dto.amount;
    if (dto.currency !== undefined) cost.currency = dto.currency;

    if (target !== day) {
      // Moved to another day: the same entry, with the same id, in a new list.
      const moved = {
        _id: cost._id,
        mode: cost.mode,
        fromCityId: cost.fromCityId,
        toCityId: cost.toCityId,
        amount: cost.amount,
        currency: cost.currency,
      } as TransportCost;
      day.transportCosts = day.transportCosts.filter(
        (candidate) => candidate._id.toString() !== costId,
      );
      target.transportCosts.push(moved);
    }

    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /** ITN-16: delete a transport cost of your own itinerary. */
  async remove(
    costId: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const { itinerary, day } = await this.findOwnedCostOrThrow(costId, userId);

    day.transportCosts = day.transportCosts.filter(
      (candidate) => candidate._id.toString() !== costId,
    );
    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /** Both cities are in the city list, and the trip goes from one to another. */
  private async assertValidTrip(
    fromCityId: string,
    toCityId: string,
  ): Promise<void> {
    if (fromCityId === toCityId) {
      throw new BadRequestException(
        'fromCityId and toCityId must be different cities',
      );
    }
    await this.itinerariesService.assertCityExists(fromCityId);
    await this.itinerariesService.assertCityExists(toCityId);
  }

  /** Finds the itinerary that holds this transport cost: 404, then 403 if it is not yours. */
  private async findOwnedCostOrThrow(
    costId: string,
    userId: string,
  ): Promise<TransportCostLocation> {
    const itinerary = await this.itineraries.findOne({
      'days.transportCosts._id': new Types.ObjectId(costId),
    });
    if (!itinerary) {
      throw new NotFoundException('Transport cost not found');
    }
    if (itinerary.ownerId.toString() !== userId) {
      throw new ForbiddenException('You can only change your own itineraries');
    }
    for (const day of itinerary.days) {
      const cost = day.transportCosts.find(
        (candidate) => candidate._id.toString() === costId,
      );
      if (cost) return { itinerary, day, cost };
    }
    throw new NotFoundException('Transport cost not found');
  }
}
