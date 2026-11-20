import { Types } from 'mongoose';
import type { HotelPublicSummary } from '../../hotels/hotels.service';
import type { PublicItineraryCard } from '../../itineraries/public-itineraries.service';
import { FavouriteTargetType } from '../enums/favourite-target-type.enum';
import { toFavouriteResponse, type FavouriteSource } from './favourite.mapper';

const ID = new Types.ObjectId('6741c0ffee0ddba11ad0f00d');
const HOTEL_ID = '6740f1c2a4b5c6d7e8f90123';
const ITINERARY_ID = '6741c0ffee0ddba11ad0c0de';
const ADDED = new Date('2026-11-20T20:00:00.000+02:00');

const hotel: HotelPublicSummary = {
  id: HOTEL_ID,
  name: 'Cairo Garden Hotel',
  cityId: 'EG-CAI',
  countryCode: 'EG',
  starClass: 4,
  averageRating: 4.5,
  ratingCount: 12,
  firstPhoto: 'garden.jpg',
};
const itinerary: PublicItineraryCard = {
  id: ITINERARY_ID,
  title: 'Ten days in Egypt',
  countries: ['EG'],
  startDate: '2026-12-20',
  dayCount: 10,
  authorName: 'Sara Ahmed',
};

const saved = (
  targetType: FavouriteTargetType,
  targetId: string,
): FavouriteSource => ({
  _id: ID,
  targetType,
  targetId: new Types.ObjectId(targetId),
  createdAt: ADDED,
});

const targets = {
  hotels: new Map([[HOTEL_ID, hotel]]),
  itineraries: new Map([[ITINERARY_ID, itinerary]]),
};
const none = { hotels: new Map(), itineraries: new Map() };

describe('toFavouriteResponse (BON-02)', () => {
  it('shows an available hotel with its public card, its first photo URL and the UTC time', () => {
    expect(
      toFavouriteResponse(saved(FavouriteTargetType.Hotel, HOTEL_ID), targets),
    ).toEqual({
      id: ID.toString(),
      targetType: 'hotel',
      targetId: HOTEL_ID,
      addedAt: '2026-11-20T18:00:00.000Z',
      available: true,
      hotel: {
        name: 'Cairo Garden Hotel',
        cityId: 'EG-CAI',
        countryCode: 'EG',
        starClass: 4,
        averageRating: 4.5,
        ratingCount: 12,
        photoUrl: '/api/uploads/garden.jpg',
      },
      itinerary: null,
    });
  });

  it('gives a hotel without a photo a null photo URL', () => {
    const noPhoto = {
      hotels: new Map([[HOTEL_ID, { ...hotel, firstPhoto: null }]]),
      itineraries: new Map(),
    };

    expect(
      toFavouriteResponse(saved(FavouriteTargetType.Hotel, HOTEL_ID), noPhoto)
        .hotel?.photoUrl,
    ).toBeNull();
  });

  it('shows an available itinerary with its title, author name and header, never the author id', () => {
    const response = toFavouriteResponse(
      saved(FavouriteTargetType.Itinerary, ITINERARY_ID),
      targets,
    );

    expect(response).toMatchObject({
      targetType: 'itinerary',
      targetId: ITINERARY_ID,
      available: true,
      hotel: null,
      itinerary: {
        title: 'Ten days in Egypt',
        authorName: 'Sara Ahmed',
        countries: ['EG'],
        startDate: '2026-12-20',
        dayCount: 10,
      },
    });
    expect(Object.keys(response.itinerary ?? {}).sort()).toEqual([
      'authorName',
      'countries',
      'dayCount',
      'startDate',
      'title',
    ]);
  });

  it.each([
    ['hotel', FavouriteTargetType.Hotel, HOTEL_ID],
    ['itinerary', FavouriteTargetType.Itinerary, ITINERARY_ID],
  ])(
    'marks a %s whose card was not found as not available, with no summary',
    (_label, type, id) => {
      expect(toFavouriteResponse(saved(type, id), none)).toMatchObject({
        available: false,
        hotel: null,
        itinerary: null,
      });
    },
  );

  it('never takes the card of the other type for the same id', () => {
    const sameId = {
      hotels: new Map([[ITINERARY_ID, { ...hotel, id: ITINERARY_ID }]]),
      itineraries: new Map(),
    };

    expect(
      toFavouriteResponse(
        saved(FavouriteTargetType.Itinerary, ITINERARY_ID),
        sameId,
      ).available,
    ).toBe(false);
  });

  it('returns only the listed fields: no owner id or moderation', () => {
    expect(
      Object.keys(
        toFavouriteResponse(
          saved(FavouriteTargetType.Hotel, HOTEL_ID),
          targets,
        ),
      ).sort(),
    ).toEqual([
      'addedAt',
      'available',
      'hotel',
      'id',
      'itinerary',
      'targetId',
      'targetType',
    ]);
  });
});
