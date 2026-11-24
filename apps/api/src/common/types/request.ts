import type { Request } from "express";
import type { JwtPayload } from "@universal-pos/shared";

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}
