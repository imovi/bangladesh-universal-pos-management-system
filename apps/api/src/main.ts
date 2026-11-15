import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ConfigService } from "./common/config/config.service.js";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get("PORT");

  // Prefix: /api/v1
  app.setGlobalPrefix("api/v1");

  // Interceptors & Exception Filters
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS
  app.enableCors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  });

  await app.listen(port);
  logger.log(`Universal POS API is running on port: ${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal bootstrap failure:", err);
  process.exit(1);
});
