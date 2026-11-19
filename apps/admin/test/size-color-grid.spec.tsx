import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SizeColorGrid } from "../src/components/common/size-color-grid";

describe("SizeColorGrid Component", () => {
  const sizes = ["S", "M", "L"];
  const colors = ["Black", "White"];
  const matrix = {
    "Black:S": { value: 10 },
    "Black:M": { value: 20 },
    "Black:L": { value: 0 },
    "White:S": { value: 5 },
    "White:M": { value: 15 },
    "White:L": { value: 30 },
  };

  it("renders table with all sizes as column headers and colours as row headers", () => {
    render(<SizeColorGrid sizes={sizes} colors={colors} matrix={matrix} readOnly />);

    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByText("Black")).toBeInTheDocument();
    expect(screen.getByText("White")).toBeInTheDocument();
  });

  it("marks out-of-stock and low-stock cells in readOnly stock mode", () => {
    render(<SizeColorGrid sizes={sizes} colors={colors} matrix={matrix} readOnly mode="stock" />);

    // Zero quantity cell
    expect(screen.getByText("শূন্য (Out)")).toBeInTheDocument();
    // Low quantity cell (<= 5)
    expect(screen.getByText("কম (Low)")).toBeInTheDocument();
  });

  it("calls onChange when an input value is modified", () => {
    const handleChange = vi.fn();
    render(
      <SizeColorGrid
        sizes={sizes}
        colors={colors}
        matrix={matrix}
        onChange={handleChange}
        readOnly={false}
      />
    );

    const cellInputs = screen.getAllByRole("spinbutton").slice(1);
    fireEvent.change(cellInputs[0], { target: { value: "25" } });

    expect(handleChange).toHaveBeenCalledWith("Black", "S", 25);
  });

  it("applies value to all cells using Apply to All toolbar", () => {
    const handleChange = vi.fn();
    render(
      <SizeColorGrid
        sizes={sizes}
        colors={colors}
        matrix={matrix}
        onChange={handleChange}
        readOnly={false}
      />
    );

    const applyInput = screen.getByPlaceholderText("10");
    fireEvent.change(applyInput, { target: { value: "50" } });

    const applyButton = screen.getByRole("button", { name: /Apply to All/i });
    fireEvent.click(applyButton);

    expect(handleChange).toHaveBeenCalledTimes(6); // 2 colors * 3 sizes
    expect(handleChange).toHaveBeenCalledWith("Black", "S", 50);
    expect(handleChange).toHaveBeenCalledWith("White", "L", 50);
  });

  it("sorts size column headers in canonical standard order (XS, S, M, L, XL, XXL, numbers)", () => {
    const unorderedSizes = ["L", "XL", "M", "XS", "32", "30"];
    render(<SizeColorGrid sizes={unorderedSizes} colors={["Blue"]} matrix={{}} readOnly />);

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    // First header is the row label 'রং \ সাইজ (Colour \ Size)', followed by sizes
    expect(headers.slice(1)).toEqual(["XS", "M", "L", "XL", "30", "32"]);
  });
});
