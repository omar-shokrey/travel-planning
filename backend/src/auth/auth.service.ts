import { Injectable } from '@nestjs/common';
import type { UserResponseDto } from '../users/dto/user-response.dto';
import { toUserResponse } from '../users/mappers/user.mapper';
import { UsersService } from '../users/users.service';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Creates the account of a guest (ACC-01). The DTO has already checked the
   * consent, so the time of this request is stored as the time it was given.
   * Registering does not log the user in.
   */
  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const user = await this.usersService.createRegisteredUser({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      consentAcceptedAt: new Date(),
    });
    return toUserResponse(user);
  }
}
