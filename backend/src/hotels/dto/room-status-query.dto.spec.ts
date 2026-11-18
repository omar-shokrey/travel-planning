import {
  type ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { validationExceptionFactory } from '../../common/pipes/validation-exception.factory';
import { RoomStatusQueryDto } from './room-status-query.dto';

// The same options as the global pipe in main.ts.
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: validationExceptionFactory,
});
const metadata: ArgumentMetadata = {
  type: 'query',
  metatype: RoomStatusQueryDto,
};

describe('RoomStatusQueryDto (HTL-08)', () => {
  it('accepts a date range and pages through the rooms', async () => {
    const query = (await pipe.transform(
      { from: '2026-12-01', to: '2026-12-15', page: '2' },
      metadata,
    )) as RoomStatusQueryDto;

    expect(query).toMatchObject({
      from: '2026-12-01',
      to: '2026-12-15',
      page: 2,
      limit: 10,
    });
  });

  it.each([
    {},
    { from: '2026-12-01' },
    { to: '2026-12-15' },
    { from: '2026-12-15', to: '2026-12-01' },
    { from: '2026-12-01', to: '2026-12-01' },
    { from: '2026-02-30', to: '2026-03-02' },
    { from: '2026-12-01T00:00:00Z', to: '2026-12-15' },
    { from: '2026-12-01', to: '2026-12-15', status: 'booked' },
  ])('rejects %j', async (query) => {
    await expect(pipe.transform(query, metadata)).rejects.toThrow(
      BadRequestException,
    );
  });
});
