import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import * as morgan from 'morgan';
import { ValidationPipe } from '@nestjs/common';
import { CustomExceptionFilter } from 'helpers/custom-exception.filter';
import { CustomResponseInterceptor } from 'helpers/custom-sucess.filter';

const corsOptions: CorsOptions = {
  credentials: true,
  methods: ['POST', 'PUT', 'DELETE', 'GET'],
  origin: ['http://localhost:3000', 'https://www.aims.osiris.so', 'https://aims.osiris.so'],
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  AppModule.registerSwagger(app);
  app.enableCors(corsOptions);
  app.use(morgan('dev'));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new CustomExceptionFilter());
  app.useGlobalInterceptors(new CustomResponseInterceptor());
  await app.listen(4040, () => console.info('Api Server started on port 4040'));
}
bootstrap();
