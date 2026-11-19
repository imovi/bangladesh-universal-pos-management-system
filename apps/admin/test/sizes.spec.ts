import { describe, it, expect } from "vitest";
import { sortSizes, compareSizes } from "@universal-pos/shared";

describe("sortSizes and compareSizes", () => {
  it("sorts standard alpha sizes in fixed order XS, S, M, L, XL, XXL", () => {
    const input = ["L", "XL", "M", "S", "XXL", "XS"];
    expect(sortSizes(input)).toEqual(["XS", "S", "M", "L", "XL", "XXL"]);
  });

  it("sorts numbers ascending after alpha sizes", () => {
    const input = ["34", "M", "30", "L", "32", "XS"];
    expect(sortSizes(input)).toEqual(["XS", "M", "L", "30", "32", "34"]);
  });

  it("sorts non-standard descriptions alphabetically after numbers", () => {
    const input = ["One Size", "32", "Custom", "M", "Free Size", "S", "30"];
    expect(sortSizes(input)).toEqual(["S", "M", "30", "32", "Custom", "Free Size", "One Size"]);
  });

  it("handles case-insensitivity and whitespace", () => {
    const input = [" xl ", "m", "  S  ", "xs"];
    expect(sortSizes(input)).toEqual(["xs", "  S  ", "m", " xl "]);
  });
});
