import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * تقييد الوصول لأدوار محددة (RBAC).
 * مثال: @Roles(UserRole.VENDOR, UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'permissions';

/**
 * تقييد الوصول لصلاحيات دقيقة.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * تعليم مسار بأنه عام (بدون مصادقة).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
