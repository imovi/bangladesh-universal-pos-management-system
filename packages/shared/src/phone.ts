/**
 * Normalizes phone numbers, especially Bangladesh mobile numbers.
 * Converts '01XXXXXXXXX' or '8801XXXXXXXXX' to '+8801XXXXXXXXX'.
 * Strips all spaces, dashes, parentheses.
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.replace(/[\s\-\(\)\.]/g, "");

  // If starts with +8801...
  if (/^\+8801\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  // If starts with 8801...
  if (/^8801\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // If starts with 01... (11 digits standard BD format)
  if (/^01\d{9}$/.test(cleaned)) {
    return `+88${cleaned}`;
  }

  // If starts with 1... (10 digits without leading 0)
  if (/^1\d{9}$/.test(cleaned)) {
    return `+880${cleaned}`;
  }

  return cleaned;
}
