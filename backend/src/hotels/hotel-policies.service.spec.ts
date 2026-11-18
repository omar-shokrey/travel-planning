import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HotelPoliciesService } from './hotel-policies.service';
import type { HotelsService } from './hotels.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const USER_ID = '6740f1c2a4b5c6d7e8f90124';

const POLICIES = {
  checkInTime: '14:00',
  checkOutTime: '12:00',
  cancellationTiers: [
    { daysBefore: 30, refundPercent: 100 },
    { daysBefore: 7, refundPercent: 50 },
  ],
};

interface StoredPolicy {
  checkInTime: string;
  checkOutTime: string;
  cancellationTiers: { daysBefore: number; refundPercent: number }[];
}

const setup = () => {
  const hotel = {
    policy: undefined as StoredPolicy | undefined,
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
  describe('set (HTL-09, HTL-10)', () => {
    it('stores the times and the tiers on the hotel and returns them', async () => {
      const { service, hotel } = setup();

      const result = await service.set(HOTEL_ID, POLICIES, USER_ID);

      expect(hotel.policy).toEqual(POLICIES);
      expect(hotel.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual(POLICIES);
    });

    it('stores the tiers with the highest threshold first, whatever order they came in', async () => {
      const { service, hotel } = setup();

      const result = await service.set(
        HOTEL_ID,
        {
          ...POLICIES,
          cancellationTiers: [
            { daysBefore: 1, refundPercent: 10 },
            { daysBefore: 30, refundPercent: 100 },
            { daysBefore: 7, refundPercent: 50 },
          ],
        },
        USER_ID,
      );

      const expected = [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 1, refundPercent: 10 },
      ];
      expect(hotel.policy?.cancellationTiers).toEqual(expected);
      expect(result.cancellationTiers).toEqual(expected);
    });

    it('replaces the policies that were set before, including the tiers', async () => {
      const { service, hotel } = setup();
      hotel.policy = POLICIES;

      await service.set(
        HOTEL_ID,
        { checkInTime: '15:30', checkOutTime: '11:00', cancellationTiers: [] },
        USER_ID,
      );

      expect(hotel.policy).toEqual({
        checkInTime: '15:30',
        checkOutTime: '11:00',
        cancellationTiers: [],
      });
    });

    it('asks for the hotel as the logged-in moderator', async () => {
      const { service, hotelsService } = setup();

      await service.set(HOTEL_ID, POLICIES, USER_ID);

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

      await expect(service.set(HOTEL_ID, POLICIES, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );

      expect(hotel.save).not.toHaveBeenCalled();
    });

    it('answers 404 for a hotel that does not exist', async () => {
      const { service, hotelsService } = setup();
      hotelsService.findManagedEntityOrThrow.mockRejectedValue(
        new NotFoundException('Hotel not found'),
      );

      await expect(service.set(HOTEL_ID, POLICIES, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
