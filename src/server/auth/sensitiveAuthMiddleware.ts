import { Request, Response, NextFunction } from 'express';
import { ISensitiveTokenVerifier, ServerSupabaseAuthVerifier, VerifiedAuthContext } from './supabaseAuth';

export interface SensitiveAuthenticatedRequest extends Request {
  authenticatedUserId?: string;
  authenticatedAuthContext?: VerifiedAuthContext;
}

export function createSensitiveAuthMiddleware(
  verifier?: ISensitiveTokenVerifier,
  getCurrentTimeSec?: () => number
) {
  return async (req: SensitiveAuthenticatedRequest, res: Response, next: NextFunction) => {
    const activeVerifier = verifier ?? new ServerSupabaseAuthVerifier();
    const getTime = getCurrentTimeSec ?? (() => Math.floor(Date.now() / 1000));

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

    const nowSec = getTime();

    try {
      if (!activeVerifier.verifyTokenWithClaims) {
        return res.status(503).json({ error: "Service Unavailable" });
      }

      const result = await activeVerifier.verifyTokenWithClaims(token, nowSec);

      if (result.status === 'unconfigured' || result.status === 'service_error') {
        return res.status(503).json({ error: "Service Unavailable" });
      }

      if (result.status === 'invalid' || !result.context) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const ctx = result.context;

      // Sensitive Auth Freshness Checks
      // 1. aal must be "aal2"
      if (ctx.aal !== 'aal2') {
        return res.status(403).json({ error: "SENSITIVE_REAUTH_REQUIRED" });
      }

      // 2. amr must contain password and otp methods
      const passwordMethod = ctx.amr.find((item) => item.method === 'password');
      const otpMethod = ctx.amr.find((item) => item.method === 'otp');

      if (!passwordMethod || !otpMethod) {
        return res.status(403).json({ error: "SENSITIVE_REAUTH_REQUIRED" });
      }

      // 3. Password method age: 0 <= (nowSec - timestamp) <= 300
      const passwordAge = nowSec - passwordMethod.timestamp;
      if (passwordAge < 0 || passwordAge > 300) {
        return res.status(403).json({ error: "SENSITIVE_REAUTH_REQUIRED" });
      }

      // 4. OTP method age: 0 <= (nowSec - timestamp) <= 300
      const otpAge = nowSec - otpMethod.timestamp;
      if (otpAge < 0 || otpAge > 300) {
        return res.status(403).json({ error: "SENSITIVE_REAUTH_REQUIRED" });
      }

      // 5. Future tolerance check for all methods: <= nowSec + 30
      for (const item of ctx.amr) {
        if (item.timestamp > nowSec + 30) {
          return res.status(403).json({ error: "SENSITIVE_REAUTH_REQUIRED" });
        }
      }

      req.authenticatedUserId = ctx.userId;
      req.authenticatedAuthContext = ctx;
      return next();
    } catch (err) {
      return res.status(503).json({ error: "Service Unavailable" });
    }
  };
}
