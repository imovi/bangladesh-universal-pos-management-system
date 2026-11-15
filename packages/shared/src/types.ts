export const BUSINESS_TYPES = [
  "fashion",
  "retail",
  "chemical",
  "ecommerce",
  "pharmacy",
  "electronics",
  "other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * Money represented as integer minor units (poisha / cents).
 * 100 poisha = 1 BDT.
 */
export type Poisha = number;

export interface ApiPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiMeta {
  timestamp: string;
  requestId: string;
  pagination?: ApiPaginationMeta;
}

export interface ApiErrorDetail {
  field?: string;
  issue: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}

export interface JwtPayload {
  sub: string; // user id
  tenantId: string;
  tenantSlug: string;
  email: string;
  roles: string[];
  permissions: string[];
  isOwner: boolean;
  iat?: number;
  exp?: number;
}
