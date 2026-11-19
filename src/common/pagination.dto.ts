import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;
}

export function paginated<T>(data: T[], total: number, q: PaginationQueryDto) {
  return { data, meta: { total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) } };
}
