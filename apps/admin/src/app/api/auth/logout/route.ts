import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyCsrf } from "@/lib/csrf";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  const csrfBlock = verifyCsrf(req);
  if (csrfBlock) return csrfBlock;

  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("pos_refresh_token")?.value;
  const authHeader = req.headers.get("authorization");

  if (refreshToken) {
    try {
      await fetch(`${env.NEXT_PUBLIC_API_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
          "x-request-id": req.headers.get("x-request-id") || crypto.randomUUID(),
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Ignore backend logout errors; cookie will be cleared regardless
    }
  }

  cookieStore.delete("pos_refresh_token");

  return NextResponse.json({
    success: true,
    data: { loggedOut: true },
  });
}
