import { BadRequestException, type ValidationError } from '@nestjs/common';
import {
  flattenValidationErrors,
  validationExceptionFactory,
} from './validation-exception.factory';

const errors: ValidationError[] = [
  {
    property: 'email',
    constraints: { isEmail: 'email must be an email' },
  },
  {
    property: 'passengers',
    children: [
      {
        property: '0',
        children: [
          {
            property: 'name',
            constraints: {
              isNotEmpty: 'name should not be empty',
              minLength: 'name is too short',
            },
          },
        ],
      },
    ],
  },
];

const flat = [
  { field: 'email', messages: ['email must be an email'] },
  {
    field: 'passengers.0.name',
    messages: ['name should not be empty', 'name is too short'],
  },
];

describe('flattenValidationErrors', () => {
  it('gives one entry per invalid field with its full path', () => {
    expect(flattenValidationErrors(errors)).toEqual(flat);
  });

  it('returns an empty list when nothing failed', () => {
    expect(flattenValidationErrors([])).toEqual([]);
  });
});

describe('validationExceptionFactory', () => {
  it('builds a 400 with the field errors', () => {
    const exception = validationExceptionFactory(errors);
    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getResponse()).toEqual({
      message: 'Validation failed',
      errors: flat,
    });
  });
});
