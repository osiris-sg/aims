import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import * as morgan from 'morgan';
import { ValidationPipe } from '@nestjs/common';
import { CustomExceptionFilter } from 'helpers/custom-exception.filter';
import { CustomResponseInterceptor } from 'helpers/custom-sucess.filter';

const corsOptions: CorsOptions = {
  credentials: true,
  methods: ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'],
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = ['http://localhost:3000', 'https://www.aims.osiris.so', 'https://aims.osiris.so'];

    // Allow Vercel deployments
    if (origin.includes('vercel.app')) {
      return callback(null, true);
    }

    // Allow Render deployments
    if (origin.includes('onrender.com')) {
      return callback(null, true);
    }

    // Allow osiris.so subdomains
    if (origin.includes('osiris.so')) {
      return callback(null, true);
    }

    // Allow ai-ms.io and subdomains (production frontend)
    if (origin.includes('ai-ms.io')) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // For development, allow all localhost origins
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    console.log('CORS blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
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
  const port = process.env.PORT || 4040;
  await app.listen(port, '0.0.0.0', () => console.info(`Api Server started on port ${port}`));
}
bootstrap();
