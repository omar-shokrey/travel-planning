import { Types } from 'mongoose';
import { imageUrl } from '../../uploads/uploads.constants';
import { toAirlineResponse, type AirlineSource } from './airline.mapper';

const source: AirlineSource = {
  _id: new Types.ObjectId('6740f1c2a4b5c6d7e8f90123'),
  name: 'EgyptAir',
  code: 'MS',
  logo: 'a1b2c3d4-e5f6-4789-9012-345678abcdef.png',
  active: true,
  createdAt: new Date('2026-11-05T13:00:00.000+02:00'),
  updatedAt: new Date('2026-11-06T14:30:00.000+02:00'),
};

describe('toAirlineResponse', () => {
  it('maps every public field and formats dates as ISO UTC strings', () => {
    const response = toAirlineResponse(source);

    expect(response).toEqual({
      id: '6740f1c2a4b5c6d7e8f90123',
      name: 'EgyptAir',
      code: 'MS',
      logo: source.logo,
      logoUrl: imageUrl(source.logo),
      active: true,
      cancellationTiers: [],
      extraBagPrice: null,
      extraBagCurrency: 'USD',
      maxExtraBags: 0,
      createdAt: '2026-11-05T11:00:00.000Z',
      updatedAt: '2026-11-06T12:30:00.000Z',
    });
    expect(typeof response.id).toBe('string');
    expect(response.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(response.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('leaves out MongoDB internals and unexpected fields', () => {
    const stored = {
      ...source,
      __v: 3,
      internalNote: 'private',
    };

    expect(Object.keys(toAirlineResponse(stored)).sort()).toEqual([
      'active',
      'cancellationTiers',
      'code',
      'createdAt',
      'extraBagCurrency',
      'extraBagPrice',
      'id',
      'logo',
      'logoUrl',
      'maxExtraBags',
      'name',
      'updatedAt',
    ]);
  });

  it('returns the stored cancellation tiers as plain objects, in the stored order (FLT-09)', () => {
    const tiers = [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ];
    const stored = {
      ...source,
      policy: {
        cancellationTiers: tiers.map((tier) => ({ ...tier, _internal: 1 })),
      },
    };

    const response = toAirlineResponse(stored);

    expect(response.cancellationTiers).toEqual(tiers);
    expect(response.cancellationTiers).not.toBe(
      stored.policy.cancellationTiers,
    );
  });

  it('shows an empty policy for an airline stored before FLT-09', () => {
    expect(toAirlineResponse(source).cancellationTiers).toEqual([]);
    expect(
      toAirlineResponse({ ...source, policy: undefined }).cancellationTiers,
    ).toEqual([]);
  });

  it('returns the extra-bag rule flat, next to the tiers (FLT-08)', () => {
    const response = toAirlineResponse({
      ...source,
      policy: { cancellationTiers: [], extraBagPrice: 5000, maxExtraBags: 2 },
    });

    expect(response.extraBagPrice).toBe(5000);
    expect(response.extraBagCurrency).toBe('USD');
    expect(response.maxExtraBags).toBe(2);
    expect(response).not.toHaveProperty('policy');
  });

  it('keeps 0 extra bags as 0, with the stored price (FLT-08)', () => {
    const response = toAirlineResponse({
      ...source,
      policy: { cancellationTiers: [], extraBagPrice: 2500, maxExtraBags: 0 },
    });

    expect(response.extraBagPrice).toBe(2500);
    expect(response.maxExtraBags).toBe(0);
  });

  it('shows no extra-bag rule for an airline stored before FLT-08, or before its moderator set one', () => {
    for (const stored of [
      source,
      { ...source, policy: undefined },
      { ...source, policy: { cancellationTiers: [] } },
    ]) {
      const response = toAirlineResponse(stored);
      expect(response.extraBagPrice).toBeNull();
      expect(response.maxExtraBags).toBe(0);
    }
  });
});
