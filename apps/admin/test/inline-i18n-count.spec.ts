import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

function scanDirectory(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe("Inline i18n String Guard", () => {
  it("enforces strict ceiling on inline locale === 'bn' occurrences across apps/admin/src", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const sourceFiles = scanDirectory(srcDir);
    const pattern = /locale\s*===\s*["']bn["']/g;

    let inlineCount = 0;
    const occurrencesByFile: Record<string, number> = {};

    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, "utf-8");
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        inlineCount += matches.length;
        const relativePath = path.relative(srcDir, filePath);
        occurrencesByFile[relativePath] = matches.length;
      }
    }

    // Step 0.4 baseline was 765 occurrences before migration of POS receipt, payment dialog, return modal, and shift dialogs.
    // The new baseline after Step 0.4 is 681 occurrences. Guard against regressions with strict ceiling of 685.
    const MAX_ALLOWED_INLINE_OCCURRENCES = 685;

    expect(
      inlineCount,
      `Inline locale === 'bn' count (${inlineCount}) exceeded ceiling of ${MAX_ALLOWED_INLINE_OCCURRENCES}. Move strings to dictionary.`
    ).toBeLessThanOrEqual(MAX_ALLOWED_INLINE_OCCURRENCES);
  });
});
