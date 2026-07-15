import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './common/filters/app-exception.filter';

/** 应用启动：全局前缀 /api、参数校验、统一异常 envelope、CORS。 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AppExceptionFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? true });

  const port = Number(process.env.PORT ?? 3001); // web 占 3000
  await app.listen(port);
  Logger.log(`star-memorial-api 已启动: http://localhost:${port}/api/health`, 'Bootstrap');
}

void bootstrap();
