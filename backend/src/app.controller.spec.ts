import { ServiceUnavailableException } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  const controllerWith = (readyState: number): AppController =>
    new AppController(new AppService({ readyState } as Connection));

  it('reports the API and the database as up when connected', () => {
    expect(controllerWith(1).getHealth()).toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it.each([0, 2, 3])(
    'throws 503 when the database state is %i',
    (readyState) => {
      expect(() => controllerWith(readyState).getHealth()).toThrow(
        ServiceUnavailableException,
      );
    },
  );
});
