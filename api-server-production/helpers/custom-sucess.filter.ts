import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
// import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CustomResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Apply only to HTTP (REST APIs)
    if (context.getType() !== 'http') {
      return next.handle(); // Bypass for non-HTTP contexts (e.g., GraphQL)
    }

    return next.handle().pipe(
      map((data) => {
        return {
          success: true,
          data,
          message: 'Action Succeeded',
        };
      }),
    );
  }
}
