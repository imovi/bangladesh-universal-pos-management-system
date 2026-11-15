import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Response, Request } from "express";
import { v7 as uuidv7 } from "uuid";
import { ZodError } from "zod";
import { ApiEnvelope } from "@universal-pos/shared";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers["x-request-id"] as string) || uuidv7();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_SERVER_ERROR";
    let message = "An unexpected error occurred";
    let details: Array<{ field?: string; issue: string }> | undefined;

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = "VALIDATION_ERROR";
      message = "Request validation failed";
      details = exception.errors.map((err) => ({
        field: err.path.join("."),
        issue: err.message,
      }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        message = res;
      } else if (typeof res === "object" && res !== null) {
        const errorObj = res as Record<string, unknown>;
        message = (errorObj.message as string) || exception.message;
        code = (errorObj.code as string) || HttpStatus[status] || code;
        if (Array.isArray(errorObj.details)) {
          details = errorObj.details;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled Exception: ${exception.message}`,
        exception.stack,
      );
      // Mask internal errors in non-development environments
      message =
        process.env.NODE_ENV === "development"
          ? exception.message
          : "Internal server error";
    }

    const errorEnvelope: ApiEnvelope<null> = {
      success: false,
      data: null,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId,
      },
    };

    response.status(status).json(errorEnvelope);
  }
}
