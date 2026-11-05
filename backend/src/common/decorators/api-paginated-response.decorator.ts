import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMeta } from '../dto/paginated-response.dto';

/**
 * Documents a paginated list in Swagger as `{ items: Model[], meta }`.
 * Use it instead of @ApiOkResponse on list endpoints:
 * `@ApiPaginatedResponse(FlightResponseDto)`.
 */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
) =>
  applyDecorators(
    ApiExtraModels(PaginationMeta, model),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'meta'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMeta) },
        },
      },
    }),
  );
