export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export function isPaginatedResponse(value: unknown): value is PaginatedResponse<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    Array.isArray(value.data) &&
    'pagination' in value &&
    typeof (value as { pagination: unknown }).pagination === 'object' &&
    (value as { pagination: unknown }).pagination !== null
  );
}
