import { Catch, ExceptionFilter, ArgumentsHost } from '@nestjs/common';

@Catch()
export class CustomExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    console.log('error', exception);
    // format the response
    const formattedResponse = {
      success: false,
      message: exception.message,
      data: {},
    };

    // set the response headers and status code
    const status_code = exception.status || 400;
    response.status(status_code);
    response.setHeader('Content-Type', 'application/json');

    // send the formatted response
    response.send(formattedResponse);
  }
}
