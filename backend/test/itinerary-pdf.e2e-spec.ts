import './support/auth-env';
import { getModelToken } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import type { Response } from 'superagent';
import { LOGIN_REQUIRED_MESSAGE } from './../src/auth/auth.constants';
import { ProviderType } from './../src/common/enums/provider-type.enum';
import { Role } from './../src/common/enums/role.enum';
import { formatMoneyList } from './../src/itineraries/itinerary-pdf';
import { User } from './../src/users/models/user.schema';
import { deleteSessionsOf } from './support/delete-sessions';
import {
  createItineraryFixture,
  FIXTURE_CURRENCY,
  type FixtureUser,
  type ItineraryFixture,
} from './support/itinerary-fixture';
import { sessionCookieFor } from './support/session-cookie';

interface Money {
  amount: number;
  currency: string;
}

/** Collects a binary answer into a Buffer (supertest parses only text). */
const binary = (
  response: Response,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * The text of a PDF: every Flate stream is inflated, then each text line
 * (`[<hex> kerning <hex>] TJ`) is decoded and joined.
 */
const pdfText = (pdf: Buffer): string => {
  const raw = pdf.toString('latin1');
  const lines: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      content = match[1];
    }
    for (const [, parts] of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push(
        [...parts.matchAll(/<([0-9a-f]*)>/g)]
          .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
          .join(''),
      );
    }
  }
  return lines.join('\n');
};

/** The page count of a PDF, from its page tree. */
const pageCount = (pdf: Buffer) =>
  Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(pdf.toString('latin1'))?.[1]);

describe('Export an itinerary as PDF (e2e, ITN-28)', () => {
  let fixture: ItineraryFixture;
  let users: Model<User>;
  let owner: FixtureUser;
  let other: FixtureUser;
  let adminCookie = '';
  const staff: { id: string; cookie: string; role: Role }[] = [];

  const http = () => fixture.http();

  const download = (
    itineraryId: string,
    // `null` for a guest: an explicit `undefined` would take the default.
    cookie: string | null = owner.cookie,
  ) => {
    const call = http()
      .get(`/api/itineraries/${itineraryId}/pdf`)
      .buffer(true)
      .parse(binary);
    return cookie ? call.set('Cookie', cookie) : call;
  };

  /** A user made straight in the database, with a session (ACC-06). */
  const createStaff = async (role: Role) => {
    const user = await users.create({
      name: `ITN-28 ${role}`,
      email: `itn28-${role}-${randomUUID()}@example.com`,
      passwordHash: 'not-a-real-hash',
      role,
      consentAcceptedAt: new Date(),
      ...(role === Role.HotelModerator && {
        assignment: {
          providerType: ProviderType.Hotel,
          providerId: new Types.ObjectId(),
        },
      }),
    });
    const id = user._id.toString();
    staff.push({ id, role, cookie: await sessionCookieFor(fixture.app, id) });
    return staff[staff.length - 1].cookie;
  };

  beforeAll(async () => {
    fixture = await createItineraryFixture();
    users = fixture.app.get<Model<User>>(getModelToken(User.name));
    owner = await fixture.createUser();
    other = await fixture.createUser();
    adminCookie = await createStaff(Role.Admin);
    await createStaff(Role.HotelModerator);
  });

  afterAll(async () => {
    // Nothing to clean when the setup itself failed (for example no database).
    if (!fixture) return;
    for (const { id } of staff) {
      await deleteSessionsOf(fixture.app, id);
      await users.findByIdAndDelete(id);
    }
    await fixture.cleanup();
  });

  it('gives the owner the PDF as an attachment with a safe name', async () => {
    const itinerary = await fixture.createItinerary(
      owner,
      [fixture.cityA],
      'Ten days in the test country',
    );

    const response = await download(itinerary.id);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="ten-days-in-the-test-country.pdf"',
    );
    const pdf = response.body as Buffer;
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(Number(response.headers['content-length'])).toBe(pdf.length);
  });

  it('exports every kind of cost, a linked booking (ITN-27) and the same figures as the budget summary', async () => {
    const itinerary = await fixture.createItinerary(owner, [
      fixture.cityA,
      fixture.cityB,
    ]);
    const [first, second] = itinerary.days.map((day) => day.id);
    await http()
      .post(`/api/itineraries/${itinerary.id}/days/${first}/activities`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Old town walk', cost: 1500, currency: FIXTURE_CURRENCY })
      .expect(201);
    await http()
      .post(`/api/itineraries/${itinerary.id}/days/${first}/budgets`)
      .set('Cookie', owner.cookie)
      .send({ category: 'food', amount: 4500, currency: FIXTURE_CURRENCY })
      .expect(201);
    await http()
      .post(`/api/itineraries/${itinerary.id}/transport-costs`)
      .set('Cookie', owner.cookie)
      .send({
        dayId: second,
        mode: 'train',
        fromCityId: fixture.cityA,
        toCityId: fixture.cityB,
        amount: 2000,
        currency: FIXTURE_CURRENCY,
      })
      .expect(201);
    // An owner-only linked booking, stored as the link route stores it.
    await fixture.itineraries.findByIdAndUpdate(itinerary.id, {
      $push: {
        'days.1.linkedBookings': {
          bookingType: 'hotel',
          bookingId: new Types.ObjectId(),
          reference: 'HB-ITN28X',
          amount: 37500,
          currency: FIXTURE_CURRENCY,
        },
      },
    });
    const summary = (
      await http()
        .get(`/api/itineraries/${itinerary.id}/budget-summary`)
        .set('Cookie', owner.cookie)
        .expect(200)
    ).body as {
      total: Money[];
      byCategory: { category: string; total: Money[] }[];
    };

    const response = await download(itinerary.id);

    expect(response.status).toBe(200);
    const text = pdfText(response.body as Buffer);
    expect(text).toContain('Old town walk: USD 15.00');
    expect(text).toContain('Food: USD 45.00');
    expect(text).toContain('Hotel reservation HB-ITN28X: USD 375.00');
    expect(text).toContain(`Total: ${formatMoneyList(summary.total)}`);
    const accommodation = summary.byCategory.find(
      (line) => line.category === 'accommodation',
    );
    expect(text).toContain(
      `Accommodation: ${formatMoneyList(accommodation?.total ?? [])}`,
    );
  });

  it('exports an itinerary without days', async () => {
    const itinerary = await fixture.createItinerary(owner, []);

    const response = await download(itinerary.id);

    expect(response.status).toBe(200);
    expect(pdfText(response.body as Buffer)).toContain('No days yet.');
  });

  it('exports a 60-day itinerary with several activities a day', async () => {
    const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
    // 60 days are written straight in the test database: 60 add requests
    // would test ITN-05 again, not the export.
    await fixture.itineraries.findByIdAndUpdate(itinerary.id, {
      $set: {
        dayCount: 60,
        days: Array.from({ length: 60 }, (_, index) => ({
          cityId: index % 2 ? fixture.cityA : fixture.cityB,
          notes: `Day ${index + 1} notes that are long enough to wrap. `.repeat(
            3,
          ),
          activities: Array.from({ length: 4 }, (_, activity) => ({
            name: `Activity ${activity + 1}`,
            cost: 1000,
            currency: FIXTURE_CURRENCY,
          })),
        })),
      },
    });

    const response = await download(itinerary.id);

    expect(response.status).toBe(200);
    const pdf = response.body as Buffer;
    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(5);
    expect(pdfText(pdf)).toContain(`Page ${pages} of ${pages}`);
  });

  it('exports a title with Arabic, emoji and quotes, with a safe file name', async () => {
    const itinerary = await fixture.createItinerary(
      owner,
      [fixture.cityA],
      'رحلة "Nile" 😀',
    );

    const response = await download(itinerary.id);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="nile.pdf"',
    );
    expect(pdfText(response.body as Buffer)).toContain('???? "Nile" ?');
  });

  it('lets the owner export a public itinerary and one an admin hid', async () => {
    const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
    await http()
      .patch(`/api/itineraries/${itinerary.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'public' })
      .expect(200);
    expect((await download(itinerary.id)).status).toBe(200);

    await http()
      .patch(`/api/admin/content/itinerary/${itinerary.id}`)
      .set('Cookie', adminCookie)
      .send({ moderation: 'hidden' })
      .expect(200);
    const hidden = await download(itinerary.id);

    expect(hidden.status).toBe(200);
    expect(pdfText(hidden.body as Buffer)).toContain(
      'Hidden by an administrator',
    );
  });

  it('changes nothing in the itinerary', async () => {
    const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);
    const version = () =>
      fixture.itineraries
        .findById(itinerary.id)
        .select('__v updatedAt')
        .lean<{ __v: number; updatedAt: Date }>();
    const before = await version();

    await download(itinerary.id).expect(200);

    const after = await version();
    expect(after?.__v).toBe(before?.__v);
    expect(after?.updatedAt.toISOString()).toBe(
      before?.updatedAt.toISOString(),
    );
  });

  describe('who may export (as GET /api/itineraries/:id)', () => {
    it("answers 403 for another user's itinerary and 404 for a missing one", async () => {
      const others = await fixture.createItinerary(other, [fixture.cityA]);

      const foreign = await download(others.id);
      expect(foreign.status).toBe(403);
      const opened = await http()
        .get(`/api/itineraries/${others.id}`)
        .set('Cookie', owner.cookie);
      expect(opened.status).toBe(403);

      expect((await download(new Types.ObjectId().toString())).status).toBe(
        404,
      );
    });

    it('answers 400 for an id that is not an id', async () => {
      expect((await download('not-an-id')).status).toBe(400);
    });

    it('answers 401 to a guest, and 403 to an administrator and a moderator', async () => {
      const itinerary = await fixture.createItinerary(owner, [fixture.cityA]);

      const guest = await http().get(`/api/itineraries/${itinerary.id}/pdf`);
      expect(guest.status).toBe(401);
      expect(guest.body.message).toBe(LOGIN_REQUIRED_MESSAGE);
      for (const { cookie } of staff) {
        expect((await download(itinerary.id, cookie)).status).toBe(403);
      }
    });
  });

  it('is documented in Swagger as a binary PDF with its answers', async () => {
    const response = await http().get('/api/docs-json').expect(200);
    const operation = (
      response.body as {
        paths: Record<
          string,
          Record<
            string,
            {
              responses: Record<
                string,
                { content?: Record<string, { schema: object }> }
              >;
            }
          >
        >;
      }
    ).paths['/api/itineraries/{id}/pdf'].get;

    expect(operation.responses['200'].content).toEqual({
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    });
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
  });
});
