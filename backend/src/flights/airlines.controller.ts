
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { ImageFile } from '../uploads/uploads.types';
import { UploadImage } from '../uploads/decorators/upload-image.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

@ApiTags('Airlines')
@ApiCookieAuth()
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlinesService: AirlinesService) {}

  @Post()
  @Roles(Role.Admin)
  @UploadImage('logo')
  @ApiOperation({ summary: 'Create an airline profile' })
  @ApiCreatedResponse({
    description: 'Airline profile created successfully',
  })
  create(
    @Body() dto: CreateAirlineDto,
    @UploadedFile() logo: ImageFile,
  ) {
    return this.airlinesService.create(dto, logo);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an airline profile by ID' })
  @ApiOkResponse({ description: 'Airline profile retrieved successfully' })
  findById(@Param('id') id: string) {
    return this.airlinesService.findById(id);
  }

  @Patch(':id')
  @Roles(Role.AirlineModerator)
  @UploadImage('logo')
  @ApiOperation({ summary: 'Update an assigned airline profile' })
  @ApiOkResponse({ description: 'Airline profile updated successfully' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAirlineDto,
    @UploadedFile() logo: ImageFile,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.airlinesService.update(id, user.id, dto, logo);
  }
}
