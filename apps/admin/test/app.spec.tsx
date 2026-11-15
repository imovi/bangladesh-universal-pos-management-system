import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "../src/app/page.js";
import { env } from "../src/env.js";

describe("Milestone A0: Admin Workspace Verification", () => {
  it("validates default environment configuration successfully", () => {
    expect(env.NEXT_PUBLIC_API_URL).toBeDefined();
    expect(env.NEXT_PUBLIC_API_URL).toMatch(/^https?:\/\//);
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("Universal POS Admin");
  });

  it("renders the initial blank landing page with Bangla typography support", () => {
    render(<HomePage />);
    expect(screen.getByText("Universal POS Admin")).toBeInTheDocument();
    expect(
      screen.getByText("বাংলাদেশ সার্বজনীন পিওএস ব্যাক অফিস ম্যানেজমেন্ট ড্যাশবোর্ড"),
    ).toBeInTheDocument();
    expect(screen.getByText("Phase 1B Ready")).toBeInTheDocument();
  });
});
