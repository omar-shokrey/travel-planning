import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { PASSWORD_SALT_ROUNDS } from '../common/constants/password';
import { Role } from '../common/enums/role.enum';
import { UserStatus } from '../common/enums/user-status.enum';
import { Airport } from '../reference/models/airport.schema';
import { Attraction } from '../reference/models/attraction.schema';
import { City } from '../reference/models/city.schema';
import { Country } from '../reference/models/country.schema';
import { User } from '../users/models/user.schema';
import { loadReferenceData } from './csv-files';
import {
  FILE_NAMES,
  findProblems,
  planChanges,
  supportedCurrencies,
  type Entry,
  type Fields,
  type ReferenceData,
} from './reference-data';

type Validatable = { validate: () => Promise<unknown> };

type Store<T extends Fields> = {
  find: () => PromiseLike<object[]>;
  insert: (records: T[]) => PromiseLike<unknown>;
  update: (id: string, changes: Fields) => PromiseLike<unknown>;
};

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly config: ConfigService,
  ) {}

  async run({ dryRun }: { dryRun: boolean }): Promise<void> {
    const data = loadReferenceData();
    const problems = [
      ...findProblems(data),
      ...(await this.findInvalidRecords(data)),
    ];
    if (problems.length > 0) {
      throw new Error(
        `The reference data is not valid. Nothing was written:\n- ${problems.join('\n- ')}`,
      );
    }
    const adminMissing = await this.isAdminMissing();

    if (dryRun) {
      this.logger.log('Dry run: nothing will be written');
    }
    await this.syncReferenceData(data, dryRun);

    if (!adminMissing) {
      this.logger.log('Administrator account already exists, left unchanged');
    } else if (dryRun) {
      this.logger.log('Administrator account would be created');
    } else {
      await this.createAdmin();
      this.logger.log('Administrator account created');
    }

    this.logger.log(
      `Currencies in the reference data: ${supportedCurrencies(data.countries).join(', ')}`,
    );
  }

  private async findInvalidRecords(data: ReferenceData): Promise<string[]> {
    return [
      ...(await this.invalidIn(
        FILE_NAMES.countries,
        data.countries,
        (record) => new this.countries(record),
      )),
      ...(await this.invalidIn(
        FILE_NAMES.cities,
        data.cities,
        (record) => new this.cities(record),
      )),
      ...(await this.invalidIn(
        FILE_NAMES.airports,
        data.airports,
        (record) => new this.airports(record),
      )),
      ...(await this.invalidIn(
        FILE_NAMES.attractions,
        data.attractions,
        (record) => new this.attractions(record),
      )),
    ];
  }

  private async invalidIn<T>(
    file: string,
    entries: Entry<T>[],
    build: (record: T) => Validatable,
  ): Promise<string[]> {
    const problems: string[] = [];
    for (const { line, record } of entries) {
      try {
        await build(record).validate();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        problems.push(`${file} line ${line}: ${reason}`);
      }
    }
    return problems;
  }

  private async syncReferenceData(
    data: ReferenceData,
    dryRun: boolean,
  ): Promise<void> {
    await this.sync('countries', data.countries, dryRun, {
      find: () => this.countries.find().lean(),
      insert: (records) => this.countries.insertMany(records),
      update: (id, changes) =>
        this.countries.updateOne({ _id: id }, { $set: changes }),
    });
    await this.sync('cities', data.cities, dryRun, {
      find: () => this.cities.find().lean(),
      insert: (records) => this.cities.insertMany(records),
      update: (id, changes) =>
        this.cities.updateOne({ _id: id }, { $set: changes }),
    });
    await this.sync('airports', data.airports, dryRun, {
      find: () => this.airports.find().lean(),
      insert: (records) => this.airports.insertMany(records),
      update: (id, changes) =>
        this.airports.updateOne({ _id: id }, { $set: changes }),
    });
    await this.sync('attractions', data.attractions, dryRun, {
      find: () => this.attractions.find().lean(),
      insert: (records) => this.attractions.insertMany(records),
      update: (id, changes) =>
        this.attractions.updateOne({ _id: id }, { $set: changes }),
    });
  }

  private async sync<T extends Fields>(
    label: string,
    entries: Entry<T>[],
    dryRun: boolean,
    store: Store<T>,
  ): Promise<void> {
    const plan = planChanges(
      entries.map(({ record }) => record),
      await store.find(),
    );

    if (!dryRun) {
      if (plan.insert.length > 0) {
        await store.insert(plan.insert);
      }
      for (const { id, changes } of plan.update) {
        await store.update(id, changes);
      }
    }

    this.logger.log(
      `${label}: ${plan.insert.length} added, ${plan.update.length} updated, ${plan.unchanged} unchanged${dryRun ? ' (dry run)' : ''}`,
    );
  }

  private adminEmail(): string {
    return this.config.getOrThrow<string>('ADMIN_EMAIL').trim().toLowerCase();
  }

  private async isAdminMissing(): Promise<boolean> {
    const existing = await this.users.findOne({ email: this.adminEmail() });
    if (!existing) {
      return true;
    }
    if (existing.role !== Role.Admin) {
      throw new Error(
        'ADMIN_EMAIL belongs to an account that is not an administrator. Use another email. Nothing was written.',
      );
    }
    return false;
  }

  private async createAdmin(): Promise<void> {
    const passwordHash = await hash(
      this.config.getOrThrow<string>('ADMIN_PASSWORD'),
      PASSWORD_SALT_ROUNDS,
    );
    await this.users.init();
    await this.users.create({
      name: 'Administrator',
      email: this.adminEmail(),
      passwordHash,
      role: Role.Admin,
      status: UserStatus.Active,
    });
  }
}
