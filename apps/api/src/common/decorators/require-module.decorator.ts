import { SetMetadata } from "@nestjs/common";
import type { ModuleKey } from "@universal-pos/shared";

export const REQUIRED_MODULES_METADATA_KEY = "required_modules";

/**
 * Every endpoint of a business module in later phases must use this decorator.
 * It enforces that the specified module(s) are active (both allowed by platform
 * and enabled by the tenant owner) before allowing access.
 */
export const RequireModule = (...keys: ModuleKey[]) =>
  SetMetadata(REQUIRED_MODULES_METADATA_KEY, keys);
