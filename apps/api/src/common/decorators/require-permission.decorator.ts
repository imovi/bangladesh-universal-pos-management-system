import { SetMetadata } from "@nestjs/common";
import { PermissionKey } from "@universal-pos/shared";

export const PERMISSION_KEY = "permissions";
export const RequirePermission = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSION_KEY, permissions);
