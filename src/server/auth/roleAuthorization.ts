import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import { AuthorizationContextService, UiRole, GetAuthorizationContextOptions } from './authorizationContextService';

export type SystemRole = 'admin' | 'accountant' | 'cashier' | 'seller' | 'agent' | 'user';

/**
 * Resolves user's server-side mapped UI role from real DB authorization context.
 * NEVER trusts any role parameter supplied by the client.
 */
export async function resolveUserServerRole(
  userId: string,
  options?: GetAuthorizationContextOptions
): Promise<UiRole> {
  if (!userId || typeof userId !== 'string') {
    return null;
  }
  const result = await AuthorizationContextService.getAuthorizationContext(userId, options);
  if (result.status === 'authorized') {
    return result.context.uiRole;
  }
  return null;
}

/**
 * Verifies if the authenticated user has administrative privileges from server-side DB source.
 * Matching real DB role 'org_admin' or legacy DB role 'admin'.
 */
export async function verifyServerAdminAccess(
  userId: string,
  options?: GetAuthorizationContextOptions
): Promise<boolean> {
  const role = await resolveUserServerRole(userId, options);
  return role === 'admin';
}

/**
 * Express middleware ensuring server-side role authorization.
 * Ignores any client-supplied role claims.
 */
export function createServerRoleMiddleware(
  requiredRoles: (UiRole | SystemRole)[],
  options?: GetAuthorizationContextOptions
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Strip/ignore any client-provided role/permission/org attempts in request
    if (req.body && typeof req.body === 'object') {
      delete req.body.role;
      delete req.body.isAdmin;
      delete req.body.permissions;
      delete req.body.organizationId;
    }
    if (req.query && typeof req.query === 'object') {
      delete req.query.role;
      delete req.query.isAdmin;
      delete req.query.permissions;
      delete req.query.organizationId;
    }

    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const authResult = await AuthorizationContextService.getAuthorizationContext(userId, options);

      if (authResult.status === 'service_error') {
        return res.status(503).json({ error: "Service Unavailable" });
      }

      if (authResult.status !== 'authorized') {
        return res.status(403).json({ error: "FORBIDDEN_INSUFFICIENT_ROLE" });
      }

      const { uiRole, roleCodes } = authResult.context;

      // Check if uiRole or any roleCodes matches requiredRoles
      const hasRole = requiredRoles.some((reqRole) => {
        if (!reqRole) return false;
        if (uiRole === reqRole) return true;
        if (roleCodes.includes(reqRole)) return true;
        // 'admin' matches 'org_admin' or 'admin'
        if (reqRole === 'admin' && (roleCodes.includes('org_admin') || roleCodes.includes('admin'))) {
          return true;
        }
        return false;
      });

      if (!hasRole) {
        return res.status(403).json({ error: "FORBIDDEN_INSUFFICIENT_ROLE" });
      }

      return next();
    } catch {
      return res.status(503).json({ error: "Service Unavailable" });
    }
  };
}

/**
 * Express middleware ensuring server-side fine-grained permission authorization.
 */
export function createServerPermissionMiddleware(
  requiredPermissions: string[],
  options?: GetAuthorizationContextOptions
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      delete req.body.role;
      delete req.body.isAdmin;
      delete req.body.permissions;
      delete req.body.organizationId;
    }
    if (req.query && typeof req.query === 'object') {
      delete req.query.role;
      delete req.query.isAdmin;
      delete req.query.permissions;
      delete req.query.organizationId;
    }

    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const authResult = await AuthorizationContextService.getAuthorizationContext(userId, options);

      if (authResult.status === 'service_error') {
        return res.status(503).json({ error: "Service Unavailable" });
      }

      if (authResult.status !== 'authorized') {
        return res.status(403).json({ error: "FORBIDDEN_INSUFFICIENT_PERMISSION" });
      }

      const { permissions } = authResult.context;

      const hasAllPermissions = requiredPermissions.every((p) => permissions.includes(p));
      if (!hasAllPermissions) {
        return res.status(403).json({ error: "FORBIDDEN_INSUFFICIENT_PERMISSION" });
      }

      return next();
    } catch {
      return res.status(503).json({ error: "Service Unavailable" });
    }
  };
}
