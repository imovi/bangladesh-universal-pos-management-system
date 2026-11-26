import type { APIRequestContext, APIResponse } from "@playwright/test";

const API_BASE_URL = "http://localhost:4000/api/v1";
const PAGE_LIMIT = 100;
// A guard against an endless loop if the API ever keeps returning the same open shifts.
const MAX_ROUNDS = 10;

const OWNER_CREDENTIALS = {
  tenantSlug: "artisan-apparel",
  email: "owner@artisan.com",
  password: "Password123!",
};

async function failWithBody(step: string, res: APIResponse): Promise<never> {
  const body = await res.text();
  throw new Error(`[closeAllOpenShifts] ${step} failed with status ${res.status()}: ${body}`);
}

async function loginAsOwner(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/auth/login`, { data: OWNER_CREDENTIALS });
  if (!res.ok()) await failWithBody("Login", res);

  const token = (await res.json()).data?.accessToken;
  if (!token) throw new Error("[closeAllOpenShifts] Login response has no accessToken");
  return token;
}

async function listOpenShifts(request: APIRequestContext, token: string): Promise<any[]> {
  const res = await request.get(`${API_BASE_URL}/shifts?status=open&limit=${PAGE_LIMIT}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) await failWithBody("List open shifts", res);

  const json = await res.json();
  return Array.isArray(json.data) ? json.data : (json.data?.items ?? []);
}

/**
 * Closes every open shift of the seeded tenant, so the next spec starts with no open shift.
 * Fails loudly on any non-2xx response instead of hiding it.
 * Returns how many shifts it closed.
 */
export async function closeAllOpenShifts(request: APIRequestContext): Promise<number> {
  const token = await loginAsOwner(request);
  let closedCount = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const openShifts = await listOpenShifts(request, token);
    if (openShifts.length === 0) return closedCount;

    for (const shift of openShifts) {
      const res = await request.post(`${API_BASE_URL}/shifts/${shift.id}/close`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { closingCashMinor: Number(shift.openingCashMinor || 50000) },
      });
      if (!res.ok()) await failWithBody(`Close shift ${shift.id}`, res);
      closedCount++;
    }
  }

  throw new Error(`[closeAllOpenShifts] Shifts were still open after ${MAX_ROUNDS} rounds`);
}
