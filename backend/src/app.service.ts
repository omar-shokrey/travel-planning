import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

const DATABASE_CONNECTED = 1;

export interface HealthStatus {
  status: 'ok';
  database: 'up';
}

@Injectable()
export class AppService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  getHealth(): HealthStatus {
    if (this.connection.readyState !== DATABASE_CONNECTED) {
      throw new ServiceUnavailableException('The database is not connected');
    }
    return { status: 'ok', database: 'up' };
  }
}
