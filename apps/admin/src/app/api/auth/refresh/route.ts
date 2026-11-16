import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyCsrf } from "@/lib/csrf";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  const csrfBlock = verifyCsrf(req);
  if (csrfBlock) return csrfBlock;

  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("pos_refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { success: false, error: { message: "No refresh token available" } },
      { status: 401 }
    );
  }

  try {
    const apiUrl = `${env.NEXT_PUBLIC_API_URL}/auth/refresh`;
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": req.headers.get("x-request-id") || crypto.randomUUID(),
      },
      body: JSON.stringify({ refreshToken }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      cookieStore.delete("pos_refresh_token");
      return NextResponse.json(data, { status: res.status });
    }

    const { refreshToken: newRefreshToken, ...clientData } = data.data;

    if (newRefreshToken) {
      cookieStore.set("pos_refresh_token", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/auth",
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return NextResponse.json({
      success: true,
      data: clientData,
      meta: data.meta,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: { message: err.message || "Failed to refresh token" },
      },
      { status: 500 }
    );
  }
}
