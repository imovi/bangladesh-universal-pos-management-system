/**
 * Robust CSV parser supporting UTF-8 BOM, quoted fields, multi-line values,
 * Bangladeshi currency formats (1,200, 1200, 1200.50, ৳1,200), and phone normalization.
 */

export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
}

/**
 * Strips UTF-8 BOM (\uFEFF) from a string if present.
 */
export function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Parses raw CSV text into an array of headers and rows.
 */
export function parseCsv(csvText: string): { headers: string[]; rows: ParsedCsvRow[] } {
  const cleanText = stripBom(csvText).trim();
  if (!cleanText) {
    return { headers: [], rows: [] };
  }

  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i++;
        } else {
          // End of quote
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") i++;
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Normalize header keys: lowercase, remove spaces, underscores, symbols
  const rawHeaders = lines[0];
  const headers = rawHeaders.map((h) => normalizeHeaderKey(h));

  const rows: ParsedCsvRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    const rowValues = lines[r];
    // Skip empty lines
    if (rowValues.length === 1 && !rowValues[0]) continue;

    const rowObj: Record<string, string> = {};
    for (let h = 0; h < headers.length; h++) {
      const key = headers[h];
      rowObj[key] = rowValues[h] || "";
    }
    rows.push({
      rowNumber: r + 1, // 1-based line number in CSV file
      raw: rowObj,
    });
  }

  return { headers, rows };
}

export function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0980-\u09FF]/g, "") // Keep alphanumeric and Bangla characters
    .replace(/_+/g, "");
}

/**
 * Parses financial string (e.g. "1,200", "1200.50", "৳1,200", "500") into minor units (poisha).
 * Returns NaN if input cannot be parsed.
 */
export function parsePoisha(value: string | number | undefined): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Math.round(value * 100);
  }

  // Clean currency symbols, commas, spaces, Bangla digits
  const westernDigits = convertBanglaDigits(value.trim());
  const clean = westernDigits.replace(/[৳,\s$]/g, "");
  if (!clean || isNaN(Number(clean))) {
    return NaN;
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return NaN;
  return Math.round(num * 100);
}

/**
 * Converts Bengali digits (০-৯) to Western Arabic digits (0-9).
 */
export function convertBanglaDigits(input: string): string {
  const banglaDigits = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
  let result = input;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(banglaDigits[i], "g"), i.toString());
  }
  return result;
}

/**
 * Normalizes and validates a Bangladeshi mobile phone number.
 * Accepts formats: 01700000000, +8801700000000, 8801700000000, 017-00000000.
 * Valid operator prefixes in Bangladesh: 013, 014, 015, 016, 017, 018, 019.
 * Returns normalized E.164 string "+8801XXXXXXXXX", or null if invalid.
 */
export function normalizeBdPhone(rawPhone: string): string | null {
  if (!rawPhone) return null;
  const digits = convertBanglaDigits(rawPhone).replace(/[^\d]/g, "");

  // Match 11-digit local format: 01[3-9]XXXXXXXX
  if (digits.length === 11 && /^01[3-9]\d{8}$/.test(digits)) {
    return `+88${digits}`;
  }
  // Match 13-digit format with 88: 8801[3-9]XXXXXXXX
  if (digits.length === 13 && /^8801[3-9]\d{8}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}
