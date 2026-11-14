import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirportController } from './airport.controller';
import { AirportService } from './airport.service';
import { Airport, AirportSchema } from './models/airport.schema';
import { Attraction, AttractionSchema } from './models/attraction.schema';
import { City, CitySchema } from './models/city.schema';
import { Country, CountrySchema } from './models/country.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
    ]),
  ],
  controllers: [AirportController],
  providers: [AirportService],
  exports: [MongooseModule],
})
export class ReferenceModule {}
