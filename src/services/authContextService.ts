import { AuthenticatedRequestService, getDefaultAuthenticatedRequestService } from './authenticatedRequestService';

export type UiRole = 'admin' | 'accountant' | 'cashier' | 'seller' | 'agent' | null;

export interface ClientAuthContext {
  userId: string;
  membershipId: string;
  organizationId: string;
  defaultBranchId: string | null;
  roleCodes: string[];
  permissions: string[];
  uiRole: UiRole;
}

export type FetchAuthContextResult =
  | { status: 'authorized'; context: ClientAuthContext }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'organization_selection_required' }
  | { status: 'service_unavailable' }
  | { status: 'error'; message: string };

export interface AuthContextServiceOptions {
  requestService?: AuthenticatedRequestService;
  customFetch?: typeof fetch;
}

const VALID_UI_ROLES: Set<string> = new Set(['admin', 'accountant', 'cashier', 'seller', 'agent']);

export class AuthContextService {
  private currentContext: ClientAuthContext | null = null;
  private requestService: AuthenticatedRequestService;

  constructor(options?: AuthContextServiceOptions) {
    this.requestService = options?.requestService || getDefaultAuthenticatedRequestService();
  }

  /**
   * Retrieves current in-memory authorization context.
   * NEVER reads or writes to localStorage/sessionStorage.
   */
  public getAuthContext(): ClientAuthContext | null {
    return this.currentContext ? { ...this.currentContext } : null;
  }

  /**
   * Retrieves current in-memory UI role. Returns null if not authorized.
   */
  public getUiRole(): UiRole {
    return this.currentContext?.uiRole ?? null;
  }

  /**
   * Clears in-memory context.
   */
  public clear(): void {
    this.currentContext = null;
  }

  /**
   * Fetches authorization context from server endpoint GET /api/auth/context.
   * Validates response strictly against expectedUserId.
   */
  public async fetchAuthContext(
    expectedUserId: string,
    options?: AuthContextServiceOptions
  ): Promise<FetchAuthContextResult> {
    if (!expectedUserId || typeof expectedUserId !== 'string' || expectedUserId.trim() === '') {
      this.clear();
      return { status: 'unauthorized' };
    }

    const reqService = options?.requestService || this.requestService;

    try {
      const response = await reqService.fetch('/api/auth/context', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        fetchFn: options?.customFetch,
      });

      if (response.status === 401) {
        this.clear();
        return { status: 'unauthorized' };
      }

      if (response.status === 403) {
        this.clear();
        return { status: 'forbidden' };
      }

      if (response.status === 409) {
        this.clear();
        return { status: 'organization_selection_required' };
      }

      if (response.status === 503) {
        this.clear();
        return { status: 'service_unavailable' };
      }

      if (!response.ok) {
        this.clear();
        return { status: 'error', message: `HTTP ${response.status}` };
      }

      const body = await response.json();

      // Validate payload structure strictly
      if (!body || typeof body !== 'object') {
        this.clear();
        return { status: 'error', message: 'Invalid response payload' };
      }

      if (body.status !== 'authorized') {
        this.clear();
        return { status: 'error', message: 'Not authorized status' };
      }

      // Verify returned userId matches expectedUserId
      if (typeof body.userId !== 'string' || body.userId !== expectedUserId) {
        this.clear();
        return { status: 'unauthorized' };
      }

      if (typeof body.membershipId !== 'string' || !body.membershipId.trim()) {
        this.clear();
        return { status: 'error', message: 'Missing or invalid membershipId' };
      }

      if (typeof body.organizationId !== 'string' || !body.organizationId.trim()) {
        this.clear();
        return { status: 'error', message: 'Missing or invalid organizationId' };
      }

      const defaultBranchId = typeof body.defaultBranchId === 'string' ? body.defaultBranchId : null;
      const roleCodes = Array.isArray(body.roleCodes) ? body.roleCodes.filter((r: any) => typeof r === 'string') : [];
      const permissions = Array.isArray(body.permissions) ? body.permissions.filter((p: any) => typeof p === 'string') : [];

      let uiRole: UiRole = null;
      if (typeof body.uiRole === 'string' && VALID_UI_ROLES.has(body.uiRole)) {
        uiRole = body.uiRole as UiRole;
      }

      const validatedContext: ClientAuthContext = {
        userId: body.userId,
        membershipId: body.membershipId,
        organizationId: body.organizationId,
        defaultBranchId,
        roleCodes,
        permissions,
        uiRole,
      };

      this.currentContext = validatedContext;

      return {
        status: 'authorized',
        context: { ...validatedContext },
      };
    } catch (err: any) {
      this.clear();
      const msg = err?.message || 'Network request failed';

      if (msg === 'UNAUTHORIZED' || msg === 'AUTH_REQUIRED') return { status: 'unauthorized' };
      if (msg === 'FORBIDDEN') return { status: 'forbidden' };
      if (msg === 'SERVICE_UNAVAILABLE') return { status: 'service_unavailable' };

      return { status: 'error', message: msg };
    }
  }
}

let singletonAuthContextService: AuthContextService | null = null;

export function getDefaultAuthContextService(): AuthContextService {
  if (!singletonAuthContextService) {
    singletonAuthContextService = new AuthContextService();
  }
  return singletonAuthContextService;
}
