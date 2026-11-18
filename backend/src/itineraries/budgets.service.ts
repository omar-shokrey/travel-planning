import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { BudgetSummaryResponseDto } from './dto/budget-summary-response.dto';
import type { CreateBudgetEntryDto } from './dto/create-budget-entry.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import { assertNoNullFields } from './dto/null-fields';
import type { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto';
import {
  BUDGET_ENTRIES_PER_DAY_MAX,
  ITINERARY_CHANGED_MESSAGE,
} from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
import { toBudgetSummaryResponse } from './mappers/budget-summary.mapper';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import type { BudgetEntry } from './models/budget-entry.schema';
import type { ItineraryDay } from './models/itinerary-day.schema';
import { Itinerary, type ItineraryDocument } from './models/itinerary.schema';

/** The answer when a day already has the most budget entries it can have. */
export const DAY_BUDGET_FULL_MESSAGE = `A day has at most ${BUDGET_ENTRIES_PER_DAY_MAX} budget entries`;

/**
 * How many times an add reads the itinerary again after another change won
 * the race, before it answers 409.
 */
const ADD_ATTEMPTS_MAX = 5;

/** Where a budget entry sits: its itinerary, its day and the entry itself. */
interface BudgetEntryLocation {
  itinerary: ItineraryDocument;
  day: ItineraryDay;
  entry: BudgetEntry;
}

/**
 * ITN-14: the budget entries of a day, and the budget summary. Like
 * activities (ITN-10) and transport costs (ITN-16) the entries are embedded
 * in the itinerary, so the owner check, the version check and the response
 * are the itinerary's.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<Itinerary>,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  /**
   * ITN-14: add a budget entry at the end of a day of your own itinerary.
   * The update is conditional on the version that was read, and it bumps the
   * version. The limit check and the add therefore see the same itinerary:
   * two requests at the same moment can never pass
   * BUDGET_ENTRIES_PER_DAY_MAX, and a day delete or move (ITN-07, ITN-08)
   * that read the itinerary before cannot drop the entry. A request that
   * loses a race reads the itinerary again and checks again.
   */
  async add(
    itineraryId: string,
    dayId: string,
    dto: CreateBudgetEntryDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    for (let attempt = 1; ; attempt += 1) {
      const itinerary = await this.itinerariesService.findOwnedOrThrow(
        itineraryId,
        userId,
      );
      const day = this.itinerariesService.findDayOrThrow(itinerary, dayId);
      if (day.budgetEntries.length >= BUDGET_ENTRIES_PER_DAY_MAX) {
        throw new ConflictException(DAY_BUDGET_FULL_MESSAGE);
      }
      if (attempt === 1) {
        await this.itinerariesService.assertCurrencySupported(dto.currency);
      }
      // The version pins the order of the days, so the day is still at the
      // position it had when it was read.
      const position = itinerary.days.indexOf(day);
      const updated = await this.itineraries.findOneAndUpdate(
        { _id: itinerary._id, __v: itinerary.__v },
        {
          $push: {
            [`days.${position}.budgetEntries`]: {
              category: dto.category,
              amount: dto.amount,
              currency: dto.currency,
            },
          },
          $inc: { __v: 1 },
        },
        { returnDocument: 'after', runValidators: true },
      );
      if (updated) {
        return toItineraryDetailResponse(updated);
      }
      if (attempt === ADD_ATTEMPTS_MAX) {
        throw new ConflictException(ITINERARY_CHANGED_MESSAGE);
      }
    }
  }

  /**
   * ITN-14: edit a budget entry of your own itinerary. Send only what
   * changes; `null` answers 400. An empty body changes nothing.
   */
  async update(
    entryId: string,
    dto: UpdateBudgetEntryDto,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    assertNoNullFields(dto);
    const { itinerary, entry } = await this.findOwnedEntryOrThrow(
      entryId,
      userId,
    );
    if (dto.currency !== undefined) {
      await this.itinerariesService.assertCurrencySupported(dto.currency);
    }

    if (dto.category !== undefined) entry.category = dto.category;
    if (dto.amount !== undefined) entry.amount = dto.amount;
    if (dto.currency !== undefined) entry.currency = dto.currency;

    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /** ITN-14: delete a budget entry of your own itinerary. */
  async remove(
    entryId: string,
    userId: string,
  ): Promise<ItineraryDetailResponseDto> {
    const { itinerary, day } = await this.findOwnedEntryOrThrow(
      entryId,
      userId,
    );

    // A new array is written with $set, so the day loses exactly this one.
    day.budgetEntries = day.budgetEntries.filter(
      (candidate) => candidate._id.toString() !== entryId,
    );
    await this.itinerariesService.saveOrConflict(itinerary);
    return toItineraryDetailResponse(itinerary);
  }

  /** ITN-14: the total budget of your own itinerary, by category and by day. */
  async summary(
    itineraryId: string,
    userId: string,
  ): Promise<BudgetSummaryResponseDto> {
    const itinerary = await this.itinerariesService.findOwnedOrThrow(
      itineraryId,
      userId,
      'You can only see the budget of your own itineraries',
    );
    return toBudgetSummaryResponse(itinerary);
  }

  /** Finds the itinerary that holds this entry: 404, then 403 if it is not yours. */
  private async findOwnedEntryOrThrow(
    entryId: string,
    userId: string,
  ): Promise<BudgetEntryLocation> {
    const itinerary = await this.itineraries.findOne({
      'days.budgetEntries._id': new Types.ObjectId(entryId),
    });
    if (!itinerary) {
      throw new NotFoundException('Budget entry not found');
    }
    if (itinerary.ownerId.toString() !== userId) {
      throw new ForbiddenException('You can only change your own itineraries');
    }
    for (const day of itinerary.days) {
      const entry = day.budgetEntries.find(
        (candidate) => candidate._id.toString() === entryId,
      );
      if (entry) return { itinerary, day, entry };
    }
    throw new NotFoundException('Budget entry not found');
  }
}
