import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginPage from "../src/app/login/page";
import { Providers } from "../src/components/providers";
import { env } from "../src/env";

describe("Milestone A2: Login & Admin Workspace Verification", () => {
  it("validates default environment configuration successfully", () => {
    expect(env.NEXT_PUBLIC_API_URL).toBeDefined();
    expect(env.NEXT_PUBLIC_API_URL).toMatch(/^https?:\/\//);
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("Universal POS Admin");
  });

  it("renders login form with Bangla default typography and labels", () => {
    render(
      <Providers>
        <LoginPage />
      </Providers>
    );
    expect(screen.getByText("দোকানের ব্যাক অফিসে লগইন")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/artisan-apparel/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ইমেইল ঠিকানা/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/পাসওয়ার্ড/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "লগইন করুন" })).toBeInTheDocument();
  });
});
