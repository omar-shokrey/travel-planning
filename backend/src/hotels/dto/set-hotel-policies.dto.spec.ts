import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetHotelPoliciesDto } from './set-hotel-policies.dto';

const check = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(SetHotelPoliciesDto, body));
  return errors.map((error) => error.property);
};

describe('SetHotelPoliciesDto (HTL-09)', () => {
  it('accepts two times on the 24-hour clock', async () => {
    expect(
      await check({ checkInTime: '14:00', checkOutTime: '12:00' }),
    ).toEqual([]);
  });

  it('accepts midnight and the last minute of the day', async () => {
    expect(
      await check({ checkInTime: '00:00', checkOutTime: '23:59' }),
    ).toEqual([]);
  });

  it.each(['24:00', '14:60', '2:00', '14:0', '2pm', '14.00', '14:00:00', ''])(
    'rejects the check-in time "%s"',
    async (checkInTime) => {
      expect(await check({ checkInTime, checkOutTime: '12:00' })).toEqual([
        'checkInTime',
      ]);
    },
  );

  it('rejects a check-out time that is not HH:mm', async () => {
    expect(await check({ checkInTime: '14:00', checkOutTime: 'noon' })).toEqual(
      ['checkOutTime'],
    );
  });

  it('rejects a missing time, because PUT replaces the whole policy', async () => {
    expect(await check({ checkInTime: '14:00' })).toEqual(['checkOutTime']);
    expect(await check({ checkOutTime: '12:00' })).toEqual(['checkInTime']);
  });

  it('rejects a time that is not text', async () => {
    expect(await check({ checkInTime: 1400, checkOutTime: '12:00' })).toEqual([
      'checkInTime',
    ]);
  });
});
