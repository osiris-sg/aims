import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const UserOrganization = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.userOrganization;
});
