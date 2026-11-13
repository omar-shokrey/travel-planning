import { type ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ParseObjectIdPipe } from './parse-object-id.pipe';

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();
  const metadata: ArgumentMetadata = { type: 'param', data: 'hotelId' };

  it.each(['507f1f77bcf86cd799439011', '507F1F77BCF86CD799439011'])(
    'accepts %s',
    (id) => {
      expect(pipe.transform(id, metadata)).toBe(id);
    },
  );

  it.each([
    '',
    'abc',
    '507f1f77bcf86cd79943901',
    '507f1f77bcf86cd7994390111',
    '507f1f77bcf86cd79943901g',
    undefined,
    123,
  ])('rejects %p', (id) => {
    expect(() => pipe.transform(id, metadata)).toThrow(BadRequestException);
  });

  it('names the parameter in the message', () => {
    expect(() => pipe.transform('nope', metadata)).toThrow(/hotelId/);
  });
});
