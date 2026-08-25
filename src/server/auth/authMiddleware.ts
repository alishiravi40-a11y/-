import { Request, Response, NextFunction } from 'express';
import { ITokenVerifier, ServerSupabaseAuthVerifier } from './supabaseAuth';

export interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string;
}

export function createAuthMiddleware(verifier?: ITokenVerifier) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const activeVerifier = verifier ?? new ServerSupabaseAuthVerifier();

    if (!activeVerifier.isConfigured()) {
      return res.status(503).json({ error: "Service Unavailable" });
    }

    const authHeader = req.headers['authorization'];

    if (!authHeader) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (Array.isArray(authHeader)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const trimmedHeader = authHeader.trim();

    if (trimmedHeader.includes(',')) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (trimmedHeader.length > 4096) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!trimmedHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = trimmedHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const result = await activeVerifier.verifyToken(token);

      if (result.status === 'unconfigured' || result.status === 'service_error') {
        return res.status(503).json({ error: "Service Unavailable" });
      }

      if (result.status === 'invalid' || !result.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      req.authenticatedUserId = result.userId;
      return next();
    } catch (err) {
      return res.status(503).json({ error: "Service Unavailable" });
    }
  };
}
