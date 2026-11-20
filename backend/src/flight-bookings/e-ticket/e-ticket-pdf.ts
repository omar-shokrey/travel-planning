import PDFDocument from 'pdfkit';

/** One flight of the e-ticket, with its local times (GEN-06). */
export interface ETicketLeg {
  /** `Outbound` or `Return`. */
  label: string;
  airlineName: string;
  flightNumber: string;
  departureAirport: string;
  arrivalAirport: string;
  /** `YYYY-MM-DD HH:mm` at the departure airport. */
  departureLocal: string;
  departureTimeZone: string;
  departureUtcOffset: string;
  /** `YYYY-MM-DD HH:mm` at the arrival airport. */
  arrivalLocal: string;
  arrivalTimeZone: string;
  arrivalUtcOffset: string;
  cabin: string;
  seats: number;
  /** The free allowance per passenger, for example `1 bag of up to 23 kg`. */
  freeBaggage: string;
}

export interface ETicketPassenger {
  fullName: string;
  /** `Adult`, `Child` or `Infant`. */
  type: string;
  /** Only the last 3 characters are shown (see `maskPassport`). */
  passport: string;
  /** The extra bags on each leg, in leg order, for example `2 extra bags, 40 kg`. */
  extraBaggage: string[];
}

/** Everything the PDF shows. Built by `FlightBookingETicketService`. */
export interface ETicket {
  reference: string;
  legs: ETicketLeg[];
  passengers: ETicketPassenger[];
  /** Adults and children: infants occupy no seat. */
  seats: number;
  /** For example `USD 525.00`, from whole cents. */
  totalPaid: string;
}

/**
 * FLT-23: a passport number with all but its last 3 characters hidden, and
 * always 5 stars, so the ticket does not even show the number's length.
 */
export function maskPassport(passportNumber: string): string {
  return `*****${passportNumber.slice(-3)}`;
}

/** Whole cents as a price, `USD 525.00`, without floating point. */
export function formatMoney(cents: number, currency: string): string {
  return `${currency} ${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * FLT-23: the e-ticket as a PDF (pdfkit). The built-in Helvetica font covers
 * Western European letters only, so a name in another script prints wrongly;
 * the data itself is correct and the frontend shows it.
 */
export function renderETicket(ticket: ETicket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `E-ticket ${ticket.reference}` },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(20).text('E-ticket');
    doc
      .font('Helvetica')
      .fontSize(12)
      .text(`Booking reference: ${ticket.reference}`);
    doc.moveDown();

    for (const leg of ticket.legs) {
      doc
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(`${leg.label}: ${leg.airlineName} ${leg.flightNumber}`);
      doc.font('Helvetica').fontSize(11);
      doc.text(`${leg.departureAirport} to ${leg.arrivalAirport}`);
      doc.text(
        `Departure: ${leg.departureLocal} ${leg.departureAirport} time (${leg.departureTimeZone}, UTC${leg.departureUtcOffset})`,
      );
      doc.text(
        `Arrival: ${leg.arrivalLocal} ${leg.arrivalAirport} time (${leg.arrivalTimeZone}, UTC${leg.arrivalUtcOffset})`,
      );
      doc.text(`Cabin: ${leg.cabin}, ${leg.seats} seat(s)`);
      doc.text(`Free checked baggage per passenger: ${leg.freeBaggage}`);
      doc.moveDown();
    }

    doc.font('Helvetica-Bold').fontSize(14).text('Passengers');
    doc.font('Helvetica').fontSize(11);
    for (const passenger of ticket.passengers) {
      doc.text(
        `${passenger.fullName} (${passenger.type}), passport ${passenger.passport}`,
      );
      passenger.extraBaggage.forEach((bags, index) => {
        doc.text(`   ${ticket.legs[index]?.label ?? 'Flight'}: ${bags}`);
      });
    }
    doc.moveDown();

    doc.text(`Seats: ${ticket.seats}`);
    doc.font('Helvetica-Bold').text(`Total paid: ${ticket.totalPaid}`);
    doc.end();
  });
}
