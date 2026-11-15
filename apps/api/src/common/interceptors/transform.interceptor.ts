import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { v7 as uuidv7 } from "uuid";
import { ApiEnvelope } from "@universal-pos/shared";

// Ensure BigInt values serialize cleanly to JSON numbers without throwing TypeError
if (typeof BigInt !== "undefined" && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return Number(this);
  };
}

function sanitizeForJson(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object") {
    if (value instanceof Date) return value;
    if ("toFixed" in value && typeof value.toFixed === "function") {
      return Number(value.toString());
    }
    if (Array.isArray(value)) return value.map(sanitizeForJson);
    const sanitized: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      sanitized[key] = sanitizeForJson(value[key]);
    }
    return sanitized;
  }
  return value;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiEnvelope<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiEnvelope<T>> {
    const request = context.switchToHttp().getRequest();
    const requestId = (request.headers["x-request-id"] as string) || uuidv7();

    return next.handle().pipe(
      map((res) => {
        let data = res;
        let pagination;

        if (
          res &&
          typeof res === "object" &&
          "items" in res &&
          "pagination" in res
        ) {
          data = res.items;
          pagination = res.pagination;
        }

        return {
          success: true,
          data: sanitizeForJson(data),
          error: null,
          meta: {
            timestamp: new Date().toISOString(),
            requestId,
            ...(pagination ? { pagination } : {}),
          },
        };
      }),
    );
  }
}
