import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyCsrf } from "@/lib/csrf";
import { env } from "@/env";

export async function POST(req: NextRequest) {
  const csrfBlock = verifyCsrf(req);
  if (csrfBlock) return csrfBlock;

  try {
    const body = await req.json();
    const apiUrl = `${env.NEXT_PUBLIC_API_URL}/auth/login`;

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": req.headers.get("x-request-id") || crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return NextResponse.json(data, { status: res.status });
    }

    const { refreshToken, ...clientData } = data.data;

    const cookieStore = await cookies();
    cookieStore.set("pos_refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return NextResponse.json({
      success: true,
      data: clientData,
      meta: data.meta,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: { message: err.message || "Failed to connect to authentication server" },
      },
      { status: 500 }
    );
  }
}
