import { Express } from 'express';
import { SERVER_ROUTE_POLICIES, findRoutePolicy, RouteAuthorizationPolicy } from './serverRouteAuthorizationPolicy';

export interface RouteAuditEntry {
  method: string;
  path: string;
  isPublic: boolean;
  isIdentityOnly: boolean;
  hasPermissions: boolean;
  isSensitiveAdmin: boolean;
  policyId?: string;
  status: 'COVERED' | 'UNCOVERED' | 'METHOD_MISMATCH' | 'UNPROTECTED_WRITE';
}

export interface RouteCoverageAuditResult {
  success: boolean;
  totalRegisteredRoutes: number;
  totalCoveredRoutes: number;
  uncoveredRoutes: RouteAuditEntry[];
  unprotectedWriteRoutes: RouteAuditEntry[];
  methodMismatchedRoutes: RouteAuditEntry[];
  entries: RouteAuditEntry[];
}

/**
 * Automatically inspects an Express application instance and verifies 100% route policy coverage.
 */
export function verifyServerRouteCoverage(app: Express): RouteCoverageAuditResult {
  const registeredRoutes: { method: string; path: string }[] = [];

  // Extract all registered routes from Express app router stack
  if (app._router && app._router.stack) {
    for (const layer of app._router.stack) {
      if (layer.route && layer.route.path && layer.route.methods) {
        const path = layer.route.path;
        for (const methodKey of Object.keys(layer.route.methods)) {
          if (layer.route.methods[methodKey]) {
            registeredRoutes.push({
              method: methodKey.toUpperCase(),
              path,
            });
          }
        }
      }
    }
  }

  const entries: RouteAuditEntry[] = [];
  const uncoveredRoutes: RouteAuditEntry[] = [];
  const unprotectedWriteRoutes: RouteAuditEntry[] = [];
  const methodMismatchedRoutes: RouteAuditEntry[] = [];

  for (const route of registeredRoutes) {
    // Exclude catch-all wildcard SPA fallback route
    if (route.path === '*' || route.path === '*all') continue;

    const policy = findRoutePolicy(route.method, route.path);

    if (!policy) {
      const entry: RouteAuditEntry = {
        method: route.method,
        path: route.path,
        isPublic: false,
        isIdentityOnly: false,
        hasPermissions: false,
        isSensitiveAdmin: false,
        status: 'UNCOVERED',
      };
      uncoveredRoutes.push(entry);
      entries.push(entry);
      continue;
    }

    if (policy.method !== route.method) {
      const entry: RouteAuditEntry = {
        method: route.method,
        path: route.path,
        isPublic: policy.protectionType === 'public',
        isIdentityOnly: policy.protectionType === 'identity_only',
        hasPermissions: policy.protectionType === 'permission_required',
        isSensitiveAdmin: policy.protectionType === 'sensitive_admin',
        policyId: policy.policyId,
        status: 'METHOD_MISMATCH',
      };
      methodMismatchedRoutes.push(entry);
      entries.push(entry);
      continue;
    }

    const isWrite = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(route.method);
    if (isWrite && policy.protectionType === 'public' && route.path !== '/api/auth/login') {
      const entry: RouteAuditEntry = {
        method: route.method,
        path: route.path,
        isPublic: true,
        isIdentityOnly: false,
        hasPermissions: false,
        isSensitiveAdmin: false,
        policyId: policy.policyId,
        status: 'UNPROTECTED_WRITE',
      };
      unprotectedWriteRoutes.push(entry);
      entries.push(entry);
      continue;
    }

    const entry: RouteAuditEntry = {
      method: route.method,
      path: route.path,
      isPublic: policy.protectionType === 'public',
      isIdentityOnly: policy.protectionType === 'identity_only',
      hasPermissions: policy.protectionType === 'permission_required',
      isSensitiveAdmin: policy.protectionType === 'sensitive_admin',
      policyId: policy.policyId,
      status: 'COVERED',
    };
    entries.push(entry);
  }

  const success =
    uncoveredRoutes.length === 0 &&
    unprotectedWriteRoutes.length === 0 &&
    methodMismatchedRoutes.length === 0;

  return {
    success,
    totalRegisteredRoutes: registeredRoutes.length,
    totalCoveredRoutes: entries.filter((e) => e.status === 'COVERED').length,
    uncoveredRoutes,
    unprotectedWriteRoutes,
    methodMismatchedRoutes,
    entries,
  };
}
