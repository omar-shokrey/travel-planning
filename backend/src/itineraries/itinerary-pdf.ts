import PDFDocument from 'pdfkit';
import { minorUnitDigits } from '../exchange-rates/conversion';
import type { BudgetSummaryResponseDto } from './dto/budget-summary-response.dto';
import type { ItineraryDetailResponseDto } from './dto/itinerary-detail-response.dto';
import type { MoneyResponseDto } from './dto/money-response.dto';
import {
  BudgetSummaryCategory,
  SUMMARY_CATEGORY_OF,
} from './enums/budget-summary-category.enum';
import { ItineraryModeration } from './enums/itinerary-moderation.enum';
import { LinkedBookingType } from './enums/linked-booking-type.enum';

/** The longest file name stem, before `.pdf`. */
export const PDF_FILENAME_MAX = 60;

/**
 * ITN-28: text the built-in PDF fonts can draw. They cover Latin-1 only
 * (Western European letters), so any other character (Arabic, emoji...)
 * becomes "?", and control characters are dropped (a line break or a tab
 * becomes a space), so rendering never throws and never draws garbage.
 */
export function toPdfText(text: string): string {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ' ';
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      // A control character: nothing to draw.
    } else if (code > 0xff) {
      out += '?';
    } else {
      out += character;
    }
  }
  return out;
}

/**
 * ITN-28: whole minor units as a price, `EGP 450.00`, with the decimal
 * places of the currency (ISO 4217, the rule ITN-18 uses: JPY has none,
 * KWD three), without floating point and without rounding.
 */
export function formatMoney(amount: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  if (digits === 0) {
    return `${currency} ${amount}`;
  }
  const unit = 10 ** digits;
  const whole = Math.floor(amount / unit);
  const fraction = String(amount % unit).padStart(digits, '0');
  return `${currency} ${whole}.${fraction}`;
}

/** Amounts in several currencies on one line: `EGP 450.00 + USD 12.00`. */
export function formatMoneyList(amounts: readonly MoneyResponseDto[]): string {
  return amounts.length === 0
    ? 'nothing yet'
    : amounts
        .map(({ amount, currency }) => formatMoney(amount, currency))
        .join(' + ');
}

/**
 * ITN-28: a safe file name for the download, from the title: ASCII letters
 * and digits joined by "-", at most PDF_FILENAME_MAX characters, `itinerary`
 * when nothing is left. No quote, slash, backslash or line break can reach
 * the `Content-Disposition` header.
 */
export function pdfFilename(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PDF_FILENAME_MAX)
    .replace(/-+$/g, '');
  return `${slug || 'itinerary'}.pdf`;
}

/** One money line of a total: what it is, the amounts, and the conversion. */
export interface PdfMoneyLine {
  label: string;
  amounts: string;
  /** For example `EGP 1000.00`, or `not available` without a rate. */
  converted: string;
}

/** One day of the PDF. */
export interface PdfDay {
  /** `Day 1 - 2026-12-20 - Cairo`. */
  heading: string;
  notes?: string;
  activities: string[];
  budgetEntries: string[];
  transportCosts: string[];
  linkedBookings: string[];
  total: PdfMoneyLine;
}

/** Everything the itinerary PDF shows. Built by `buildItineraryPdfModel`. */
export interface ItineraryPdfModel {
  title: string;
  details: string[];
  days: PdfDay[];
  cityGroups: string[];
  categories: PdfMoneyLine[];
  total: PdfMoneyLine;
  /** The currency of the converted amounts, the rate date and any gap. */
  conversionNotes: string[];
}

/** The reference names the PDF shows instead of codes. */
export interface PdfNames {
  countries: ReadonlyMap<string, string>;
  cities: ReadonlyMap<string, string>;
}

const CATEGORY_LABEL: Readonly<Record<BudgetSummaryCategory, string>> = {
  [BudgetSummaryCategory.Food]: 'Food',
  [BudgetSummaryCategory.Accommodation]: 'Accommodation',
  [BudgetSummaryCategory.LocalTransport]: 'Local transport',
  [BudgetSummaryCategory.Activities]: 'Activities',
  [BudgetSummaryCategory.IntercityTransport]: 'Intercity transport',
};

const BOOKING_LABEL: Readonly<Record<LinkedBookingType, string>> = {
  [LinkedBookingType.Flight]: 'Flight booking',
  [LinkedBookingType.Hotel]: 'Hotel reservation',
};

/**
 * ITN-28: the PDF content, from the SAME responses the API gives the owner:
 * the itinerary detail (days, city groups, linked bookings, ITN-27) and the
 * budget summary (ITN-14, with the ITN-18 conversion). Nothing is computed
 * again here, so the PDF and the API can never disagree.
 */
export function buildItineraryPdfModel(
  detail: ItineraryDetailResponseDto,
  summary: BudgetSummaryResponseDto,
  names: PdfNames,
): ItineraryPdfModel {
  const city = (id: string) => names.cities.get(id) ?? id;
  const converted = (money: MoneyResponseDto | null | undefined) =>
    money ? formatMoney(money.amount, money.currency) : 'not available';
  const line = (
    label: string,
    amounts: MoneyResponseDto[],
    total: MoneyResponseDto | null | undefined,
  ): PdfMoneyLine => ({
    label,
    amounts: formatMoneyList(amounts),
    converted: converted(total),
  });

  const details = [
    `Countries: ${detail.countries.map((code) => names.countries.get(code) ?? code).join(', ')}`,
    `Start date: ${detail.startDate}`,
    `Days: ${detail.dayCount}`,
    `Visibility: ${detail.visibility}`,
    ...(detail.moderation === ItineraryModeration.Hidden
      ? ['Hidden by an administrator: only you and administrators can see it']
      : []),
  ];

  const days = detail.days.map((day, index): PdfDay => {
    const totals = summary.byDay[index];
    return {
      heading: `Day ${day.dayNumber} - ${day.date} - ${city(day.cityId)}`,
      ...(day.notes ? { notes: day.notes } : {}),
      activities: day.activities.map((activity) =>
        [
          activity.time ? `${activity.time} ` : '',
          activity.name,
          activity.cost != null && activity.currency
            ? `: ${formatMoney(activity.cost, activity.currency)}`
            : '',
          activity.description ? ` (${activity.description})` : '',
        ].join(''),
      ),
      budgetEntries: day.budgetEntries.map(
        (entry) =>
          `${CATEGORY_LABEL[SUMMARY_CATEGORY_OF[entry.category]]}: ${formatMoney(entry.amount, entry.currency)}`,
      ),
      transportCosts: day.transportCosts.map(
        (cost) =>
          `${cost.mode} from ${city(cost.fromCityId)} to ${city(cost.toCityId)}: ${formatMoney(cost.amount, cost.currency)}`,
      ),
      linkedBookings: day.linkedBookings.map(
        (link) =>
          `${BOOKING_LABEL[link.bookingType]} ${link.reference}: ${formatMoney(link.amount, link.currency)}`,
      ),
      total: line('Day total', totals?.total ?? [], totals?.converted),
    };
  });

  const cityGroups = detail.cityGroups.map((group) => {
    const dayRange =
      group.firstDayNumber === group.lastDayNumber
        ? `day ${group.firstDayNumber}`
        : `days ${group.firstDayNumber}-${group.lastDayNumber}`;
    return `${city(group.cityId)}, ${dayRange} (${group.startDate} to ${group.endDate}): ${formatMoneyList(group.budgetSubtotal)} (in your currency: ${converted(group.budgetSubtotalConverted)})`;
  });

  const conversionNotes: string[] = [];
  if (summary.conversion) {
    conversionNotes.push(
      `Converted to ${summary.conversion.currency} at the rates of ${summary.conversion.rateDate}.`,
    );
    if (summary.conversion.missingCurrencies.length > 0) {
      conversionNotes.push(
        `No rate for ${summary.conversion.missingCurrencies.join(', ')}: totals in these currencies are not converted.`,
      );
    }
  } else {
    conversionNotes.push(
      'No exchange rates are available yet: nothing is converted.',
    );
  }

  return {
    title: detail.title,
    details,
    days,
    cityGroups,
    categories: summary.byCategory.map((category) =>
      line(
        CATEGORY_LABEL[category.category],
        category.total,
        category.converted,
      ),
    ),
    total: line('Total', summary.total, summary.converted),
    conversionNotes,
  };
}

/** Space a day heading needs, with its first line, before a page break. */
const KEEP_WITH_NEXT = 60;

/** Space a list label ("Activities:") needs with its first item. */
const LABEL_WITH_NEXT = 30;

/**
 * ITN-28: the itinerary as an A4 PDF (pdfkit, built-in fonts), built in
 * memory. Long text wraps inside the margins; a day heading never stays alone
 * at the bottom of a page; every page has "Page x of y" at the bottom. All
 * text goes through `toPdfText` first. `compress: false` is only for tests,
 * so they can read the text.
 */
export function renderItineraryPdf(
  model: ItineraryPdfModel,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      bufferPages: true,
      compress: options.compress ?? true,
      info: { Title: toPdfText(model.title) },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const keepRoom = (height: number) => {
      if (doc.y + height > bottom()) {
        doc.addPage();
      }
    };
    const heading = (text: string, size: number) => {
      keepRoom(KEEP_WITH_NEXT);
      doc.font('Helvetica-Bold').fontSize(size).text(toPdfText(text));
      doc.font('Helvetica').fontSize(11);
    };
    const body = (text: string, indent = 0) => {
      doc.text(toPdfText(text), { indent, indentAllLines: true });
    };
    const money = (moneyLine: PdfMoneyLine) => {
      body(
        `${moneyLine.label}: ${moneyLine.amounts} (in your currency: ${moneyLine.converted})`,
      );
    };
    const list = (label: string, items: string[]) => {
      if (items.length === 0) return;
      keepRoom(LABEL_WITH_NEXT);
      body(`${label}:`);
      for (const item of items) body(`- ${item}`, 12);
    };

    doc.font('Helvetica-Bold').fontSize(20).text(toPdfText(model.title));
    doc.font('Helvetica').fontSize(11);
    for (const detail of model.details) body(detail);
    doc.moveDown();

    heading('Days', 16);
    if (model.days.length === 0) {
      body('No days yet.');
    }
    for (const day of model.days) {
      heading(day.heading, 13);
      if (day.notes) body(`Notes: ${day.notes}`);
      list('Activities', day.activities);
      list('Budget entries', day.budgetEntries);
      list('Transport', day.transportCosts);
      list('Booked', day.linkedBookings);
      money(day.total);
      doc.moveDown(0.5);
    }

    if (model.cityGroups.length > 0) {
      doc.moveDown();
      heading('Cities', 16);
      for (const group of model.cityGroups) body(group);
    }

    doc.moveDown();
    heading('Budget summary', 16);
    for (const category of model.categories) money(category);
    doc.font('Helvetica-Bold');
    money(model.total);
    doc.font('Helvetica');
    for (const note of model.conversionNotes) body(note);

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      // Writing below the bottom margin would start a new page: lift it.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(9)
        .text(
          `Page ${index + 1} of ${range.count}`,
          doc.page.margins.left,
          doc.page.height - margin + 15,
          {
            align: 'center',
            lineBreak: false,
            width:
              doc.page.width - doc.page.margins.left - doc.page.margins.right,
          },
        );
      doc.page.margins.bottom = margin;
    }
    doc.end();
  });
}
