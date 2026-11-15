import { HotelPoliciesController } from './hotel-policies.controller';
import type { HotelPoliciesService } from './hotel-policies.service';

const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const USER_ID = '6740f1c2a4b5c6d7e8f90124';

describe('HotelPoliciesController', () => {
  it('passes the hotel id, the times and the logged-in user to the service', async () => {
    const policy = { checkInTime: '14:00', checkOutTime: '12:00' };
    const service = { set: jest.fn().mockResolvedValue(policy) };
    const controller = new HotelPoliciesController(
      service as unknown as HotelPoliciesService,
    );

    expect(await controller.set(HOTEL_ID, policy, USER_ID)).toBe(policy);
    expect(service.set).toHaveBeenCalledWith(HOTEL_ID, policy, USER_ID);
  });
});
