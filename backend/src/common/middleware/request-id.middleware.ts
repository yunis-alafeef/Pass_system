import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * يضيف معرف فريد لكل طلب (FR-CP-001-01) في الرأس x-request-id.
 */
export function requestIdMiddleware(
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction,
): void {
  const id = (req.headers['x-request-id'] as string) ?? randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
