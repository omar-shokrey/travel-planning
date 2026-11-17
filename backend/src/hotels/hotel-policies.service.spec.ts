import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HotelPoliciesService } from './hotel-policies.service';
import type { HotelsService } from './hotels.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const USER_ID = '6740f1c2a4b5c6d7e8f90124';

const setup = () => {
  const hotel = {
    policy: undefined as
      { checkInTime: string; checkOutTime: string } | undefined,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const hotelsService = {
    findManagedEntityOrThrow: jest.fn().mockResolvedValue(hotel),
  };
  const service = new HotelPoliciesService(
    hotelsService as unknown as HotelsService,
  );
  return { service, hotelsService, hotel };
};

describe('HotelPoliciesService', () => {
  describe('set (HTL-09)', () => {
    it('stores the check-in and check-out times on the hotel and returns them', async () => {
      const { service, hotel } = setup();

      const result = await service.set(
        HOTEL_ID,
        { checkInTime: '14:00', checkOutTime: '12:00' },
        USER_ID,
      );

      expect(hotel.policy).toEqual({
        checkInTime: '14:00',
        checkOutTime: '12:00',
      });
      expect(hotel.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ checkInTime: '14:00', checkOutTime: '12:00' });
    });

    it('replaces the times that were set before', async () => {
      const { service, hotel } = setup();
      hotel.policy = { checkInTime: '14:00', checkOutTime: '12:00' };

      await service.set(
        HOTEL_ID,
        { checkInTime: '15:30', checkOutTime: '11:00' },
        USER_ID,
      );

      expect(hotel.policy).toEqual({
        checkInTime: '15:30',
        checkOutTime: '11:00',
      });
    });

    it('asks for the hotel as the logged-in moderator', async () => {
      const { service, hotelsService } = setup();

      await service.set(
        HOTEL_ID,
        { checkInTime: '14:00', checkOutTime: '12:00' },
        USER_ID,
      );

      expect(hotelsService.findManagedEntityOrThrow).toHaveBeenCalledWith(
        HOTEL_ID,
        USER_ID,
      );
    });

    it('answers 403 and saves nothing for a hotel the moderator does not manage', async () => {
      const { service, hotelsService, hotel } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new ForbiddenException('You do not manage this hotel'),
      );

      await expect(
        service.set(
          HOTEL_ID,
          { checkInTime: '14:00', checkOutTime: '12:00' },
          USER_ID,
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(hotel.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a hotel that does not exist', async () => {
      const { service, hotelsService } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new NotFoundException('Hotel not found'),
      );

      await expect(
        service.set(
          HOTEL_ID,
          { checkInTime: '14:00', checkOutTime: '12:00' },
          USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
