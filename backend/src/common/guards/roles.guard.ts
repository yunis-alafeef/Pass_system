import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import {
  PERMISSIONS_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators';
import {
  AuthenticatedUser,
} from '../decorators/current-user.decorator';
import { roleHasPermission } from '../constants/permissions';

/**
 * Guard للتحقق من الأدوار (Roles) والصلاحيات الدقيقة (Permissions).
 * يجب استخدامه بعد AuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('لا يوجد مستخدم مصادق عليه');
    }

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('الدور الحالي لا يملك صلاحية الوصول');
    }

    if (requiredPermissions?.length) {
      const allowed = requiredPermissions.every((perm) =>
        roleHasPermission(user.role, perm),
      );
      if (!allowed) {
        throw new ForbiddenException('لا تملك الصلاحية المطلوبة');
      }
    }

    return true;
  }
}
