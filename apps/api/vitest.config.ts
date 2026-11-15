import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "dist/**",
        "src/main.ts",
        "src/**/*.module.ts",
        "src/**/*.controller.ts",
        "src/common/database/prisma.service.ts",
        "src/common/database/tenant-context.service.ts",
        "src/types/**",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
