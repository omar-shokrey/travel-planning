import { PLATFORM_CURRENCY } from './currency';

describe('PLATFORM_CURRENCY', () => {
  it('uses USD as the platform currency', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
  });
}); 