import { UserRole } from '@prisma/client';

/**
 * خريطة الصلاحيات الافتراضية لكل دور (RBAC — FR-UI-004).
 * تُستخدم في التحقق من الصلاحيات الدقيقة داخل RolesGuard.
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.CUSTOMER]: [
    'trip:read',
    'booking:create',
    'booking:read:own',
    'booking:cancel:own',
    'payment:create',
    'profile:manage:own',
    'seat:hold',
  ],
  [UserRole.VENDOR]: [
    'trip:read',
    'trip:create',
    'trip:update:own',
    'trip:delete:own',
    'route:manage:own',
    'seat:read',
    'seat:manage:own',
    'booking:read:vendor',
    'vendor:manage:own',
    'report:read:own',
    'payout:read:own',
  ],
  [UserRole.SUPPORT_ADMIN]: [
    'trip:read',
    'booking:read',
    'booking:update',
    'user:read',
    'vendor:read',
    'report:read',
    'notification:send',
  ],
  [UserRole.FINANCE_ADMIN]: [
    'payment:read',
    'payment:refund',
    'payout:manage',
    'invoice:read',
    'report:read',
    'report:finance',
    'currency:manage',
  ],
  [UserRole.ADMIN]: ['*'],
};

/**
 * التحقق من امتلاك الدور لصلاحية معينة.
 * '*' = كل الصلاحيات.
 */
export function roleHasPermission(
  role: UserRole,
  permission: string,
): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}

/**
 * تجميع كل الصلاحيات المرتبطة بالدور (تُضاف إلى JWT payload).
 */
export function permissionsForRole(role: UserRole): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
