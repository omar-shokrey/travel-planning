import { Mongoose, Types } from 'mongoose';
import { BudgetCategory } from './enums/budget-category.enum';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import { ItineraryVisibility } from './enums/itinerary-visibility.enum';
import {
  buildItineraryPdfModel,
  formatMoney,
  formatMoneyList,
  type ItineraryPdfModel,
  PDF_FILENAME_MAX,
  pdfFilename,
  renderItineraryPdf,
  toPdfText,
} from './itinerary-pdf';
import {
  type SummaryConversion,
  toBudgetSummaryResponse,
} from './mappers/budget-summary.mapper';
import { withConvertedAmounts } from './mappers/itinerary-conversion.mapper';
import { toItineraryDetailResponse } from './mappers/itinerary.mapper';
import {
  Itinerary,
  type ItineraryDocument,
  ItinerarySchema,
} from './models/itinerary.schema';

// A real model that is never connected: only documents are built.
const mongoose = new Mongoose();
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
const ItineraryModel = mongoose.model(Itinerary.name, ItinerarySchema);

const RATES: SummaryConversion = {
  currency: 'EGP',
  rates: {
    rateDate: '2026-11-18',
    fetchedAt: new Date('2026-11-19T06:00:00.000Z'),
    rates: { USD: 1, EGP: 50 },
  },
};
const NO_RATES: SummaryConversion = { currency: 'USD', rates: null };
const NAMES = {
  countries: new Map([['EG', 'Egypt']]),
  cities: new Map([
    ['cairo', 'Cairo'],
    ['luxor', 'Luxor'],
  ]),
};

/** Two days in two cities, every kind of cost, a linked booking and a GBP entry. */
const trip = (extra: Record<string, unknown> = {}): ItineraryDocument =>
  new ItineraryModel({
    ownerId: new Types.ObjectId(),
    title: 'Ten days in Egypt',
    countries: ['EG'],
    startDate: '2026-12-20',
    visibility: ItineraryVisibility.Public,
    dayCount: 2,
    days: [
      {
        cityId: 'cairo',
        notes: 'Arrive late',
        activities: [
          {
            name: 'Egyptian Museum',
            time: '09:30',
            description: 'Book online',
            cost: 20000,
            currency: 'EGP',
          },
          { name: 'Walk' },
        ],
        budgetEntries: [
          { category: BudgetCategory.Food, amount: 1500, currency: 'USD' },
        ],
        linkedBookings: [
          {
            bookingType: 'flight',
            bookingId: new Types.ObjectId(),
            reference: 'FB-7KQ2MX',
            amount: 52000,
            currency: 'USD',
          },
        ],
      },
      {
        cityId: 'luxor',
        budgetEntries: [
          { category: BudgetCategory.Food, amount: 999, currency: 'GBP' },
        ],
        transportCosts: [
          {
            mode: 'train',
            fromCityId: 'cairo',
            toCityId: 'luxor',
            amount: 90000,
            currency: 'EGP',
          },
        ],
      },
    ],
    ...extra,
  }) as ItineraryDocument;

/** The model the export builds, from the owner's detail and summary. */
const modelOf = (
  itinerary: ItineraryDocument,
  conversion: SummaryConversion = RATES,
) => {
  const summary = toBudgetSummaryResponse(itinerary, conversion);
  const detail = withConvertedAmounts(
    toItineraryDetailResponse(itinerary),
    conversion,
  );
  return { summary, model: buildItineraryPdfModel(detail, summary, NAMES) };
};

/**
 * The text of an uncompressed PDF, one line per text operation: pdfkit writes
 * each line as hex strings split by kerning numbers (`[<48656c> 40 <6c6f>] TJ`).
 */
const pdfText = (pdf: Buffer): string =>
  [...pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)]
    .map(([, parts]) =>
      [...parts.matchAll(/<([0-9a-f]*)>/g)]
        .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');

/** The page count of a PDF, from its page tree. */
const pageCount = (pdf: Buffer) =>
  Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1]);

describe('toPdfText (ITN-28)', () => {
  it('keeps Latin-1 text, accents included', () => {
    expect(toPdfText('Cafe in Montreal, crème brûlée')).toBe(
      'Cafe in Montreal, crème brûlée',
    );
  });

  it('turns Arabic letters into "?" and an emoji into one "?"', () => {
    expect(toPdfText('رحلة')).toBe('????');
    expect(toPdfText('Trip ✈️ 😀')).toBe('Trip ?? ?');
  });

  it('turns line breaks and tabs into spaces and drops other control characters', () => {
    expect(toPdfText('a\nb\r\tc\u0000d\u0007e\u0085f')).toBe('a b  cdef');
  });

  it('keeps an empty text empty', () => {
    expect(toPdfText('')).toBe('');
  });
});

describe('formatMoney (ITN-28)', () => {
  it.each([
    [0, 'USD 0.00'],
    [1, 'USD 0.01'],
    [10, 'USD 0.10'],
    [52500, 'USD 525.00'],
    [10_000_000_000, 'USD 100000000.00'],
  ])('formats %p minor units of USD as %p', (amount, expected) => {
    expect(formatMoney(amount, 'USD')).toBe(expected);
  });

  it('uses the decimal places of the currency (ISO 4217), without rounding', () => {
    expect(formatMoney(2250, 'JPY')).toBe('JPY 2250');
    expect(formatMoney(12345, 'KWD')).toBe('KWD 12.345');
    expect(formatMoney(5, 'KWD')).toBe('KWD 0.005');
  });

  it('lists several currencies, and says so when there is nothing', () => {
    expect(
      formatMoneyList([
        { amount: 45000, currency: 'EGP' },
        { amount: 1200, currency: 'USD' },
      ]),
    ).toBe('EGP 450.00 + USD 12.00');
    expect(formatMoneyList([])).toBe('nothing yet');
  });
});

describe('pdfFilename (ITN-28)', () => {
  it.each([
    ['Ten days in Egypt', 'ten-days-in-egypt.pdf'],
    ['  Crème   brûlée  tour ', 'creme-brulee-tour.pdf'],
    ['Say "hi" / \\ again', 'say-hi-again.pdf'],
    ['رحلة 😀', 'itinerary.pdf'],
    ['', 'itinerary.pdf'],
    ['a\r\nContent-Type: text/html', 'a-content-type-text-html.pdf'],
    ['../../etc/passwd', 'etc-passwd.pdf'],
  ])('makes %p into %p', (title, expected) => {
    expect(pdfFilename(title)).toBe(expected);
  });

  it('cuts a long title, never ending on "-"', () => {
    const name = pdfFilename(`${'word '.repeat(40)}end`);

    expect(name.length).toBeLessThanOrEqual(PDF_FILENAME_MAX + 4);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.pdf$/);
  });

  it('never lets a quote, a slash, a backslash or a line break through', () => {
    for (const title of ['"', "'", '/', '\\', '\n', '\r', ';', '%22']) {
      expect(pdfFilename(`x${title}y`)).toMatch(/^[a-z0-9-]+\.pdf$/);
    }
  });
});

describe('buildItineraryPdfModel (ITN-28)', () => {
  it('names the itinerary with country names, its start date, days and visibility', () => {
    const { model } = modelOf(trip());

    expect(model.title).toBe('Ten days in Egypt');
    expect(model.details).toEqual([
      'Countries: Egypt',
      'Start date: 2026-12-20',
      'Days: 2',
      'Visibility: public',
    ]);
  });

  it('tells the owner when an admin hid the itinerary', () => {
    const { model } = modelOf(trip({ moderation: ItineraryModeration.Hidden }));

    expect(model.details).toContain(
      'Hidden by an administrator: only you and administrators can see it',
    );
  });

  it('shows every day with its date, city name, notes and every cost, linked bookings included', () => {
    const { model } = modelOf(trip());
    const [first, second] = model.days;

    expect(first).toMatchObject({
      heading: 'Day 1 - 2026-12-20 - Cairo',
      notes: 'Arrive late',
      activities: ['09:30 Egyptian Museum: EGP 200.00 (Book online)', 'Walk'],
      budgetEntries: ['Food: USD 15.00'],
      transportCosts: [],
      linkedBookings: ['Flight booking FB-7KQ2MX: USD 520.00'],
    });
    expect(second).toMatchObject({
      heading: 'Day 2 - 2026-12-21 - Luxor',
      budgetEntries: ['Food: GBP 9.99'],
      transportCosts: ['train from Cairo to Luxor: EGP 900.00'],
    });
    expect(second).not.toHaveProperty('notes');
  });

  it('shows the city groups with their subtotals', () => {
    const { model } = modelOf(trip());

    expect(model.cityGroups).toEqual([
      'Cairo, day 1 (2026-12-20 to 2026-12-20): EGP 200.00 + USD 535.00',
      'Luxor, day 2 (2026-12-21 to 2026-12-21): EGP 900.00 + GBP 9.99',
    ]);
  });

  it('takes every total and conversion from the budget summary, so the two always agree', () => {
    const { summary, model } = modelOf(trip());

    expect(model.categories.map((line) => line.label)).toEqual([
      'Food',
      'Accommodation',
      'Local transport',
      'Activities',
      'Intercity transport',
    ]);
    summary.byCategory.forEach((category, index) => {
      expect(model.categories[index].amounts).toBe(
        formatMoneyList(category.total),
      );
      expect(model.categories[index].converted).toBe(
        category.converted
          ? formatMoney(category.converted.amount, category.converted.currency)
          : 'not available',
      );
    });
    expect(model.total.amounts).toBe(formatMoneyList(summary.total));
    summary.byDay.forEach((day, index) => {
      expect(model.days[index].total.amounts).toBe(formatMoneyList(day.total));
    });
    // The flight (USD 520.00) is intercity transport, as in the summary.
    expect(model.categories[4].amounts).toBe('EGP 900.00 + USD 520.00');
  });

  it('names the currencies without a rate, as missingCurrencies does', () => {
    const { summary, model } = modelOf(trip());

    expect(summary.conversion?.missingCurrencies).toEqual(['GBP']);
    expect(model.conversionNotes).toEqual([
      'Converted to EGP at the rates of 2026-11-18.',
      'No rate for GBP: totals in these currencies are not converted.',
    ]);
    expect(model.total.converted).toBe('not available');
  });

  it('says so when no rates were ever fetched', () => {
    const { model } = modelOf(trip(), NO_RATES);

    expect(model.conversionNotes).toEqual([
      'No exchange rates are available yet: nothing is converted.',
    ]);
  });

  it('builds a model for an itinerary without days', () => {
    const { model } = modelOf(trip({ days: [], dayCount: 0 }));

    expect(model.days).toEqual([]);
    expect(model.cityGroups).toEqual([]);
    expect(model.total.amounts).toBe('nothing yet');
  });

  it('shows the code of a country or city with no name in the reference data', () => {
    const summary = toBudgetSummaryResponse(trip(), NO_RATES);
    const model = buildItineraryPdfModel(
      toItineraryDetailResponse(trip()),
      summary,
      { countries: new Map(), cities: new Map() },
    );

    expect(model.details[0]).toBe('Countries: EG');
    expect(model.days[0].heading).toBe('Day 1 - 2026-12-20 - cairo');
  });
});

describe('renderItineraryPdf (ITN-28)', () => {
  const textOf = async (model: ItineraryPdfModel) =>
    pdfText(await renderItineraryPdf(model, { compress: false }));

  it('returns a PDF', async () => {
    const pdf = await renderItineraryPdf(modelOf(trip()).model);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('draws the title, a day, a linked booking, the summary and the page footer', async () => {
    const text = await textOf(modelOf(trip()).model);

    for (const part of [
      'Ten days in Egypt',
      'Day 1 - 2026-12-20 - Cairo',
      'Flight booking FB-7KQ2MX: USD 520.00',
      'Budget summary',
      'Page 1 of 1',
    ]) {
      expect(text).toContain(part);
    }
  });

  it('gives an itinerary without days a valid PDF that says "No days yet"', async () => {
    const model = modelOf(trip({ days: [], dayCount: 0 })).model;
    const pdf = await renderItineraryPdf(model, { compress: false });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfText(pdf)).toContain('No days yet.');
  });

  it('adds pages as days are added, and numbers every page', async () => {
    const day = (index: number) => ({
      cityId: index % 2 ? 'cairo' : 'luxor',
      notes: 'A long note that wraps over more than one line. '.repeat(4),
      activities: Array.from({ length: 6 }, (_, activity) => ({
        name: `Activity ${activity + 1} of day ${index + 1}`,
        cost: 1000,
        currency: 'EGP',
      })),
    });
    const short = await renderItineraryPdf(
      modelOf(trip({ days: [day(0)], dayCount: 1 })).model,
    );
    const long = trip({
      days: Array.from({ length: 60 }, (_, index) => day(index)),
      dayCount: 60,
    });
    const started = Date.now();
    const pdf = await renderItineraryPdf(modelOf(long).model, {
      compress: false,
    });

    expect(Date.now() - started).toBeLessThan(10_000);
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(pageCount(short));
    expect(pdfText(pdf)).toContain(`Page ${pages} of ${pages}`);
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('draws a very long title and a long word without throwing', async () => {
    const model = modelOf(
      trip({ title: `${'Very long title '.repeat(20)}${'x'.repeat(300)}` }),
    ).model;

    const pdf = await renderItineraryPdf(model);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('draws Arabic, emoji and control characters as "?" or nothing, never throwing', async () => {
    const model = modelOf(trip({ title: 'رحلة\n"Trip" 😀\u0000' })).model;

    const text = await textOf(model);

    expect(text).toContain('????');
  });
});
