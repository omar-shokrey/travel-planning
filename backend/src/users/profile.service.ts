import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { LOGIN_REQUIRED_MESSAGE } from '../auth/auth.constants';
import { Country } from '../reference/models/country.schema';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { toUserResponse } from './mappers/user.mapper';
import { UNSUPPORTED_CURRENCY_MESSAGE } from './users.constants';
import { UsersService } from './users.service';

/**
 * The own account of the logged-in user (`/api/users/me`). It reads the
 * account (ACC-11), and checks what the DTO cannot check alone before it lets
 * `UsersService` write the profile (ACC-09), so the `users` collection still
 * has one writer.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
  ) {}

  /**
   * The account of the logged-in user (ACC-11). The id comes from the login
   * cookie and nothing else, so a request cannot name another account. It is
   * 401 when the account no longer exists.
   */
  async getMyProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findEntityById(userId);
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    return toUserResponse(user);
  }

  /**
   * Changes the name, the phone and the preferred currency of the logged-in
   * user (ACC-09). The DTO has validated every field; the currency is then
   * checked against the countries list (GEN-12). Only when everything is
   * valid is the profile saved, in one update.
   */
  async updateMyProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    if (
      typeof dto.preferredCurrency === 'string' &&
      !(await this.countries.exists({ currency: dto.preferredCurrency }).exec())
    ) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: [
          {
            field: 'preferredCurrency',
            messages: [UNSUPPORTED_CURRENCY_MESSAGE],
          },
        ],
      });
    }

    const user = await this.usersService.updateProfile(userId, {
      name: dto.name,
      phone: dto.phone,
      preferredCurrency: dto.preferredCurrency,
    });
    if (!user) {
      throw new UnauthorizedException(LOGIN_REQUIRED_MESSAGE);
    }
    return toUserResponse(user);
  }
}
