import { Types } from 'mongoose';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { toProviderStatusResponse } from './provider-status.mapper';

describe('toProviderStatusResponse (ACC-15)', () => {
  it('returns the type, the id as a string, the name and the active flag only', () => {
    const id = new Types.ObjectId('6740f1c2a4b5c6d7e8f90abc');
    const stored = {
      _id: id,
      name: 'EgyptAir',
      active: false,
      code: 'MS',
      logo: 'logo.png',
    };

    expect(toProviderStatusResponse(ProviderType.Airline, stored)).toEqual({
      type: 'airline',
      id: '6740f1c2a4b5c6d7e8f90abc',
      name: 'EgyptAir',
      active: false,
    });
  });
});
