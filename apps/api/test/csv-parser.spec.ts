import { describe, it, expect } from "vitest";
import {
  parseCsv,
  stripBom,
  parsePoisha,
  convertBanglaDigits,
  normalizeBdPhone,
} from "../src/modules/import/csv-parser.js";

describe("Milestone F4: CSV Import Parser Unit Tests", () => {
  describe("1. UTF-8 BOM Handling", () => {
    it("strips UTF-8 BOM character (\\uFEFF) when present", () => {
      const csvWithBom = "\uFEFFproduct_name,category,sale_price\nPanjabi,Men,1500";
      expect(stripBom(csvWithBom)).toBe("product_name,category,sale_price\nPanjabi,Men,1500");

      const parsed = parseCsv(csvWithBom);
      expect(parsed.headers).toEqual(["productname", "category", "saleprice"]);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0].raw.productname).toBe("Panjabi");
    });

    it("leaves standard CSV without BOM unchanged", () => {
      const standardCsv = "product_name,category,sale_price\nPanjabi,Men,1500";
      expect(stripBom(standardCsv)).toBe(standardCsv);
    });
  });

  describe("2. Bangla Text and Special Characters", () => {
    it("parses multi-byte Unicode Bangla text perfectly without corruption", () => {
      const csv = `product_name,category,brand,size,colour
"প্রিমিয়াম সিল্ক পাঞ্জাবি","পোশাক","আর্টিসান","৪২","গাঢ় নীল"
"সুতি পায়জামা","পোশাক","আর্টিসান","L","সাদা"`;

      const parsed = parseCsv(csv);
      expect(parsed.rows).toHaveLength(2);
      expect(parsed.rows[0].raw.productname).toBe("প্রিমিয়াম সিল্ক পাঞ্জাবি");
      expect(parsed.rows[0].raw.category).toBe("পোশাক");
      expect(parsed.rows[0].raw.colour).toBe("গাঢ় নীল");
      expect(parsed.rows[1].raw.productname).toBe("সুতি পায়জামা");
      expect(parsed.rows[1].raw.size).toBe("L");
    });
  });

  describe("3. Quoted Fields and Multi-Line Values", () => {
    it("handles commas and escaped quotes inside quoted fields", () => {
      const csv = `product_name,description,price
"Panjabi, Silk","Best ""quality"" cotton, Dhaka",2500`;

      const parsed = parseCsv(csv);
      expect(parsed.rows).toHaveLength(1);
      expect(parsed.rows[0].raw.productname).toBe("Panjabi, Silk");
      expect(parsed.rows[0].raw.description).toBe('Best "quality" cotton, Dhaka');
      expect(parsed.rows[0].raw.price).toBe("2500");
    });
  });

  describe("4. Bangladeshi Price & Poisha Formats", () => {
    it("parses comma-separated prices like 1,200 into poisha 120000", () => {
      expect(parsePoisha("1,200")).toBe(120000);
      expect(parsePoisha("1200")).toBe(120000);
      expect(parsePoisha("1200.00")).toBe(120000);
      expect(parsePoisha("1200.50")).toBe(120050);
      expect(parsePoisha("৳1,200")).toBe(120000);
      expect(parsePoisha("১,২০০")).toBe(120000); // Bangla digits
      expect(parsePoisha("২৫০০.৫০")).toBe(250050);
    });

    it("handles zero, empty and undefined gracefully", () => {
      expect(parsePoisha("0")).toBe(0);
      expect(parsePoisha("")).toBe(0);
      expect(parsePoisha(undefined)).toBe(0);
    });

    it("returns NaN for invalid price strings", () => {
      expect(isNaN(parsePoisha("abc"))).toBe(true);
      expect(isNaN(parsePoisha("Free"))).toBe(true);
    });
  });

  describe("5. Bangladeshi Mobile Phone Normalization", () => {
    it("normalizes standard 11-digit mobile numbers to E.164 (+8801XXXXXXXXX)", () => {
      expect(normalizeBdPhone("01711223344")).toBe("+8801711223344");
      expect(normalizeBdPhone("01812345678")).toBe("+8801812345678");
      expect(normalizeBdPhone("০১৭১১২২৩৩৪४".replace("४", "৪"))).toBe("+8801711223344"); // Bangla digits
    });

    it("normalizes 13-digit numbers with 88 prefix to +8801XXXXXXXXX", () => {
      expect(normalizeBdPhone("8801711223344")).toBe("+8801711223344");
      expect(normalizeBdPhone("+8801711223344")).toBe("+8801711223344");
    });

    it("returns null for invalid phone numbers", () => {
      expect(normalizeBdPhone("12345")).toBeNull(); // Too short
      expect(normalizeBdPhone("029876543")).toBeNull(); // Landline 02
      expect(normalizeBdPhone("01012345678")).toBeNull(); // Invalid prefix 010
      expect(normalizeBdPhone("+14155552671")).toBeNull(); // US number
      expect(normalizeBdPhone("invalid")).toBeNull();
    });
  });
});
