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
          data,
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
