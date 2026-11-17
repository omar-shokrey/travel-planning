import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsDefined,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
  type ValidationArguments,
} from 'class-validator';
import {
  IsBeforeDate,
  IsDateOnly,
} from '../../hotels/dto/date-only.validators';
import {
  CHILD_AGE_MAX,
  CHILD_AGE_MIN,
  HOTEL_BOOKING_MAX_GUESTS_PER_ROOM,
  HOTEL_BOOKING_MAX_ROOMS,
} from '../hotel-bookings.constants';

/** Ids are compared as text, so they are kept in lower case. */
const toLowerCase = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One room of the reservation and who stays in it (HTL-16). */
export class BookRoomDto {
  @ApiProperty({
    description:
      'Id of a room of the hotel, from the available rooms (HTL-15) or the hotel page',
    example: '6740f1c2a4b5c6d7e8f90456',
  })
  @Transform(toLowerCase)
  @IsMongoId({ message: 'roomId must be a valid id' })
  roomId: string;

  @ApiProperty({
    description:
      'Adults in this room. A room may have only children, but the reservation needs at least one adult.',
    example: 2,
    minimum: 0,
    maximum: HOTEL_BOOKING_MAX_GUESTS_PER_ROOM,
  })
  @IsInt({ message: 'adults must be a whole number' })
  @Min(0)
  @Max(HOTEL_BOOKING_MAX_GUESTS_PER_ROOM)
  @ValidateBy({
    name: 'someoneInTheRoom',
    validator: {
      validate: (value: unknown, args?: ValidationArguments): boolean => {
        const room = args?.object as BookRoomDto | undefined;
        const children = Array.isArray(room?.childAges)
          ? room.childAges.length
          : 0;
        return typeof value !== 'number' || value + children >= 1;
      },
      defaultMessage: () => 'Each room needs at least one guest',
    },
  })
  adults: number;

  @ApiPropertyOptional({
    type: [Number],
    description: `The age of each child in this room, ${CHILD_AGE_MIN} to ${CHILD_AGE_MAX}. Leave it out for no children.`,
    example: [7],
    maxItems: HOTEL_BOOKING_MAX_GUESTS_PER_ROOM,
    default: [],
  })
  @IsOptional()
  @IsArray({ message: 'childAges must be a list' })
  @ArrayMaxSize(HOTEL_BOOKING_MAX_GUESTS_PER_ROOM)
  @IsInt({ each: true, message: 'Each child age must be a whole number' })
  @Min(CHILD_AGE_MIN, {
    each: true,
    message: `Each child age must be at least ${CHILD_AGE_MIN}`,
  })
  @Max(CHILD_AGE_MAX, {
    each: true,
    message: `Each child age must be at most ${CHILD_AGE_MAX}`,
  })
  childAges: number[] = [];
}

/**
 * HTL-16 and HTL-18: what a registered user sends to reserve rooms and go to
 * payment. The price, the status, the hold and the owner are set by the
 * server, never by the client.
 */
export class CreateHotelBookingDto {
  @ApiProperty({
    description: 'Id of the hotel',
    example: '6740f1c2a4b5c6d7e8f90123',
  })
  @IsMongoId({ message: 'hotelId must be a valid id' })
  hotelId: string;

  @ApiProperty({
    description:
      'Check-in date (the first night) in YYYY-MM-DD format. Cannot be in the past (UTC).',
    example: '2026-12-10',
  })
  @IsDateOnly('checkIn')
  @IsBeforeDate('checkOut')
  checkIn: string;

  @ApiProperty({
    description:
      'Check-out date in YYYY-MM-DD format. Must be after the check-in date; at most 366 nights later.',
    example: '2026-12-13',
  })
  @IsDateOnly('checkOut')
  checkOut: string;

  @ApiProperty({
    type: [BookRoomDto],
    description: `The rooms, 1 to ${HOTEL_BOOKING_MAX_ROOMS}, each at most once, with their guests. All are reserved for the same dates.`,
    example: [
      { roomId: '6740f1c2a4b5c6d7e8f90456', adults: 2, childAges: [7] },
      { roomId: '6740f1c2a4b5c6d7e8f90457', adults: 1 },
    ],
    minItems: 1,
    maxItems: HOTEL_BOOKING_MAX_ROOMS,
  })
  @IsDefined({ message: 'rooms is required' })
  @IsArray({ message: 'rooms must be a list' })
  @ArrayMinSize(1, { message: 'Choose at least one room' })
  @ArrayMaxSize(HOTEL_BOOKING_MAX_ROOMS, {
    message: `A reservation can have at most ${HOTEL_BOOKING_MAX_ROOMS} rooms`,
  })
  @ValidateBy({
    name: 'roomsAreObjects',
    validator: {
      // Without this, ValidateNested walks into a room sent as a list.
      validate: (value: unknown): boolean =>
        !Array.isArray(value) || value.every(isPlainObject),
      defaultMessage: () => 'Each room must be an object',
    },
  })
  @ArrayUnique((room: BookRoomDto | undefined) => room?.roomId, {
    message: 'Each room can be chosen only once',
  })
  @ValidateBy({
    name: 'atLeastOneAdult',
    validator: {
      validate: (value: unknown): boolean =>
        !Array.isArray(value) ||
        !value.every(isPlainObject) ||
        (value as BookRoomDto[]).some(
          (room) => typeof room.adults === 'number' && room.adults >= 1,
        ),
      defaultMessage: () => 'A reservation needs at least one adult',
    },
  })
  @ValidateNested({ each: true })
  @Type(() => BookRoomDto)
  rooms: BookRoomDto[];

  @ApiProperty({
    description:
      "PAY-02: must be `true`. The user has seen and accepts the hotel's cancellation policy and check-in and check-out times. The moment is stored with the reservation.",
    example: true,
  })
  @Equals(true, {
    message: "You must accept the hotel's policies to continue to payment",
  })
  acceptPolicies: boolean;
}
