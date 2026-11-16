import { NextResponse } from "next/server";

export function verifyCsrf(req: Request): NextResponse | null {
  // 1. Custom header check (simple cross-origin requests cannot include custom headers without preflight)
  const clientHeader = req.headers.get("x-pos-client") || req.headers.get("x-requested-with");
  if (!clientHeader) {
    return NextResponse.json(
      { success: false, error: { message: "Missing required CSRF security header" } },
      { status: 403 }
    );
  }

  // 2. Origin check (when present)
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json(
          { success: false, error: { message: "Origin header mismatch" } },
          { status: 403 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: { message: "Invalid Origin header" } },
        { status: 403 }
      );
    }
  }

  return null;
}
