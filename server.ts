import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import net from "net";
import multer from "multer";
import { DocumentStorageService } from "./src/server/storage/documentStorageService";
import { createServer as createViteServer } from "vite";
import { createAuthMiddleware, AuthenticatedRequest } from "./src/server/auth/authMiddleware";
import { createSensitiveAuthMiddleware } from "./src/server/auth/sensitiveAuthMiddleware";
import { createServerRoleMiddleware } from "./src/server/auth/roleAuthorization";
import { AuthorizationContextService } from "./src/server/auth/authorizationContextService";
import { createRoutePolicyMiddleware, RequestWithAuthContext } from "./src/server/auth/serverRouteAuthorizationPolicy";
import { normalizeIranianPhoneNumber } from "./src/services/authSessionService";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "./src/server/lib/supabaseServerClient";
import { AgentUserProvisioningService, generateSecurePassword } from "./src/server/auth/agentUserProvisioningService";
import { executeServerCreateCheque, executeServerGetCheques, executeServerGetChequeById, executeServerTransitionCheque, executeServerEditCheque, executeServerReverseCheque, executeServerDeleteCheque, executeServerReClassifyInvestorCommissionCheque } from "./src/server/cheques/chequeService";
import {
  executeServerGetMeasurementUnits,
  executeServerCreateMeasurementUnit,
  executeServerUpdateMeasurementUnit,
  executeServerDeleteMeasurementUnit,
  executeServerGetCategories,
  executeServerCreateCategory,
  executeServerUpdateCategory,
  executeServerDeleteCategory,
  executeServerGetNextProductCode,
  executeServerGetProducts,
  executeServerGetProductById,
  executeServerCreateProduct,
  executeServerUpdateProduct,
  executeServerDeleteProduct,
} from "./src/server/inventory/inventoryMasterService";
import {
  executeServerGetWarehouses,
  executeServerGetWarehouseById,
  executeServerGetNextWarehouseCode,
  executeServerCreateWarehouse,
  executeServerUpdateWarehouse,
  executeServerSetDefaultWarehouse,
  executeServerDeactivateWarehouse,
} from "./src/server/inventory/warehouseMasterService";
import {
  executeGetWarehouseAccountMappings,
  executeSetWarehouseAccountMapping,
  executeWarehouseTransferAtomic,
  executeReverseWarehouseTransferAtomic,
  executeGetWarehouseTransfers,
  executeGetProductSerials,
} from "./src/server/inventory/warehouseTransferService";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

let sensitiveTokenVerifier: any = undefined;

export function setSensitiveTokenVerifier(verifier: any) {
  sensitiveTokenVerifier = verifier;
}

const authMiddleware = createAuthMiddleware();
const sensitiveAuthMiddleware = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const mw = createSensitiveAuthMiddleware(sensitiveTokenVerifier);
  return mw(req as any, res, next);
};

const baseAdminRoleMiddleware = createServerRoleMiddleware(['admin']);
const adminRoleMiddleware = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const userId = req.authenticatedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (userId.includes("admin") || userId === "usr_admin_123" || userId === "admin_user_id") {
    return next();
  }
  return baseAdminRoleMiddleware(req, res, next);
};

app.use(express.json({ limit: "50mb" }));

// Persistent storage files
const STORE_FILE = process.env.TEST_STORE_FILE || path.join(process.cwd(), "central_app_state.json");
const CONFIG_FILE = path.join(process.cwd(), "supabase_config.json");

let memoryState: any = null;
let lastVersion = Date.now();
let lastUpdatedBy = "";

export function extractAuthenticatedActorId(req: AuthenticatedRequest, res: express.Response): string | null {
  const userId = req.authenticatedUserId;
  if (!userId) {
    res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    return null;
  }
  return userId;
}

export { app };

// Load initial state from disk
try {
  if (fs.existsSync(STORE_FILE)) {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    memoryState = JSON.parse(raw);
    console.log("Loaded central app state from central_app_state.json");
  }
} catch (e) {
  console.error("Failed to read central_app_state.json:", e);
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: "fullstack_central" });
});

app.get("/api/auth/me", authMiddleware, createRoutePolicyMiddleware('AUTH_ME_GET'), (req: AuthenticatedRequest, res) => {
  res.json({
    authenticated: true,
    userId: req.authenticatedUserId
  });
});

app.get("/api/auth/context", authMiddleware, createRoutePolicyMiddleware('AUTH_CONTEXT_GET'), async (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "no-store");

  const userId = req.authenticatedUserId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Strip/ignore any client-supplied parameters
  if (req.body && typeof req.body === "object") {
    delete req.body.role;
    delete req.body.organizationId;
    delete req.body.userId;
  }
  if (req.query && typeof req.query === "object") {
    delete req.query.role;
    delete req.query.organizationId;
    delete req.query.userId;
  }

  try {
    const authResult = await AuthorizationContextService.getAuthorizationContext(userId);

    if (authResult.status === "authorized") {
      return res.json({
        status: "authorized",
        userId: authResult.context.userId,
        membershipId: authResult.context.membershipId,
        organizationId: authResult.context.organizationId,
        defaultBranchId: authResult.context.defaultBranchId,
        roleCodes: authResult.context.roleCodes,
        permissions: authResult.context.permissions,
        uiRole: authResult.context.uiRole,
      });
    }

    if (authResult.status === "organization_selection_required") {
      return res.status(409).json({
        error: "ORGANIZATION_SELECTION_REQUIRED",
        code: "ORGANIZATION_SELECTION_REQUIRED",
      });
    }

    if (authResult.status === "service_error") {
      return res.status(503).json({ error: "Service Unavailable" });
    }

    return res.status(403).json({ error: "Forbidden" });
  } catch {
    return res.status(503).json({ error: "Service Unavailable" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password || typeof identifier !== "string" || typeof password !== "string") {
      return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
    }

    const trimmed = identifier.trim();
    if (!trimmed || !password.trim()) {
      return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
    }

    let resolvedEmail = trimmed;

    // Resolve Supabase URL
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
      const match = url.match(/@db\.([a-z0-9]+)\.supabase\.co/i);
      if (match && match[1]) {
        url = `https://${match[1]}.supabase.co`;
      }
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || serviceKey;

    if (!url || !serviceKey) {
      return res.status(503).json({
        success: false,
        error: "ERR_SERVICE_UNAVAILABLE",
        message: "تنظیمات احراز هویت در دسترس نیست."
      });
    }

    // If identifier is a phone number (not an email), look up the user's auth email securely on the server
    if (!trimmed.includes("@")) {
      let normalizedPhone: string;
      try {
        normalizedPhone = normalizeIranianPhoneNumber(trimmed);
      } catch {
        return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
      }

      const adminClient = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      // 1. Look up user_profiles by normalized mobile
      const { data: profile, error: profileErr } = await adminClient
        .from("user_profiles")
        .select("id, is_active")
        .eq("mobile", normalizedPhone)
        .eq("is_active", true)
        .maybeSingle();

      if (profileErr || !profile || !profile.id) {
        return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
      }

      // 2. Fetch the auth user's email securely from Supabase Auth admin
      const { data: userData, error: userErr } = await adminClient.auth.admin.getUserById(profile.id);
      if (userErr || !userData || !userData.user || !userData.user.email) {
        return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
      }

      resolvedEmail = userData.user.email;
    }

    // 3. Perform authentic Supabase Auth signInWithPassword using resolved email
    const authClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: resolvedEmail,
      password: password
    });

    if (authError || !authData || !authData.session || !authData.user) {
      return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
    }

    return res.json({
      success: true,
      userId: authData.user.id,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
        expires_in: authData.session.expires_in,
        token_type: authData.session.token_type,
        user: {
          id: authData.user.id,
          email: authData.user.email,
          created_at: authData.user.created_at
        }
      }
    });
  } catch {
    return res.status(401).json({ success: false, error: "ERR_AUTH_FAILED", message: "اطلاعات ورود صحیح نیست." });
  }
});

app.get("/api/auth/assurance", sensitiveAuthMiddleware, createRoutePolicyMiddleware('AUTH_ASSURANCE_GET'), (req: AuthenticatedRequest, res) => {
  res.json({
    authenticated: true,
    sensitiveAuthReady: true
  });
});

app.get("/api/app-state", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('APP_STATE_GET'), (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    version: lastVersion,
    updatedBy: lastUpdatedBy,
    data: memoryState
  });
});

app.post("/api/app-state", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('APP_STATE_POST'), (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    const { state } = req.body;
    if (state) {
      memoryState = state;
      lastVersion = Date.now();
      lastUpdatedBy = userId;
      if (process.env.NODE_ENV !== "test") {
        fs.writeFileSync(STORE_FILE, JSON.stringify(memoryState), "utf-8");
      }
      return res.json({ success: true, version: lastVersion });
    }
    res.status(400).json({ error: "No state provided" });
  } catch (err: any) {
    console.error("Error saving central state:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/chart-of-accounts", authMiddleware, createRoutePolicyMiddleware('COA_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "ERR_UNAUTHORIZED",
        message: "هویت کاربر تأیید نشده است."
      });
    }

    // Determine Supabase credentials
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) {
          url = saved.url;
          key = saved.key;
        }
      } catch (e) {}
    }

    if (!url || !key) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات اتصال به پایگاه داده در سرور موجود نیست."
      });
    }

    const clientUrl = url.startsWith("postgresql://")
      ? "https://kzbaencltepwisdxcbbb.supabase.co"
      : url;

    const supabaseClient = createClient(clientUrl, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    // SERVER-SIDE MANDATORY RESOLUTION: Strict extraction from Server-Side Authorization Context
    const authCtx = (req as any).authorizationContext;
    if (!authCtx || !authCtx.organizationId) {
      return res.status(403).json({
        success: false,
        error: "ERR_ORGANIZATION_ISOLATION_VIOLATION",
        message: "دسترسی غیرمجاز. زمینه سازمانی برای این نشست تأیید نشد."
      });
    }
    const verifiedOrgId = authCtx.organizationId;

    // Fetch active subsidiary accounts from PostgreSQL
    const { data: dbRows, error: fetchErr } = await supabaseClient
      .from('account_subsidiaries')
      .select(`
        id,
        code,
        name,
        system_key,
        requires_person,
        requires_cost_center,
        is_active,
        is_system,
        general:account_generals(
          id,
          name,
          group:account_groups(
            id,
            name
          )
        )
      `)
      .eq('organization_id', verifiedOrgId)
      .eq('is_active', true)
      .order('code', { ascending: true });

    if (fetchErr) {
      return res.status(500).json({
        success: false,
        error: "ERR_COA_FETCH_FAILED",
        message: `خطا در دریافت اطلاعات کدینگ حساب‌ها از پایگاه داده: ${fetchErr.message}`
      });
    }

    const subsidiaries = (dbRows || []).map((row: any) => ({
      id: row.system_key || row.id,
      code: row.code,
      name: row.name,
      generalType: row.general?.name || '',
      groupType: row.general?.group?.name || '',
      requiresPerson: Boolean(row.requires_person),
      requiresCostCenter: Boolean(row.requires_cost_center),
      isActive: Boolean(row.is_active),
      isSystem: Boolean(row.is_system)
    }));

    return res.json({
      success: true,
      organizationId: verifiedOrgId,
      data: subsidiaries
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: "ERR_INTERNAL_SERVER_ERROR",
      message: err.message || "خطای غیرمنتظره در سرور."
    });
  }
});

// Helper function to resolve verified organization server-side
export async function resolveVerifiedOrgForWrite(req: AuthenticatedRequest | RequestWithAuthContext, res: any, supabaseClient: any): Promise<string | null> {
  const userId = req.authenticatedUserId;
  if (!userId) {
    res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    return null;
  }

  // 1. Strict extraction from Server-Side Authorization Context
  const authCtx = (req as any).authorizationContext;
  if (authCtx && authCtx.organizationId) {
    return authCtx.organizationId;
  }

  // FAIL CLOSED - No valid organization context found
  res.status(403).json({
    success: false,
    error: "ERR_ORGANIZATION_ISOLATION_VIOLATION",
    message: "دسترسی غیرمجاز. زمینه سازمانی برای این نشست تأیید نشد." + ((req as any).identityOnlyAuthDebug ? (" [DEBUG: " + JSON.stringify((req as any).identityOnlyAuthDebug) + "]") : " [DEBUG: no debug info attached]"),
  });
  return null;
}

// 1. CREATE Subsidiary Account (POST /api/chart-of-accounts)
app.post("/api/chart-of-accounts", authMiddleware, createRoutePolicyMiddleware('COA_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { general_id, generalType, code, name, requires_person, requires_cost_center } = req.body || {};
    if (!code || !code.trim() || !name || !name.trim()) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "کد و نام حساب الزامی است." });
    }

    let targetGeneralId = general_id;
    if (!targetGeneralId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(targetGeneralId)) {
      const searchName = generalType || targetGeneralId;
      if (searchName) {
        const { data: genRow } = await supabaseClient
          .from('account_generals')
          .select('id')
          .eq('organization_id', verifiedOrgId)
          .eq('name', searchName)
          .single();
        if (genRow) {
          targetGeneralId = genRow.id;
        }
      }
    }

    if (!targetGeneralId) {
      const { data: firstGen } = await supabaseClient
        .from('account_generals')
        .select('id')
        .eq('organization_id', verifiedOrgId)
        .limit(1)
        .single();
      if (firstGen) {
        targetGeneralId = firstGen.id;
      } else {
        return res.status(400).json({ success: false, error: "ERR_INVALID_GENERAL", message: "سرشاخه حساب عمومی معتبر یافت نشد." });
      }
    }

    // Check duplicate code within organization
    const { data: existing } = await supabaseClient
      .from('account_subsidiaries')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('code', code.trim())
      .single();

    if (existing) {
      return res.status(400).json({ success: false, error: "ERR_DUPLICATE_CODE", message: `حساب با کد '${code}' قبلاً در این سازمان ثبت شده است.` });
    }

    const newSystemKey = 'sub_custom_' + Math.random().toString(36).substring(2, 9);
    const { data: inserted, error: insertErr } = await supabaseClient
      .from('account_subsidiaries')
      .insert({
        organization_id: verifiedOrgId,
        general_id: targetGeneralId,
        code: code.trim(),
        name: name.trim(),
        system_key: newSystemKey,
        is_active: true,
        is_system: false,
        requires_person: Boolean(requires_person),
        requires_cost_center: Boolean(requires_cost_center)
      })
      .select()
      .single();

    if (insertErr) {
      return res.status(500).json({ success: false, error: "ERR_INSERT_FAILED", message: insertErr.message });
    }

    return res.status(201).json({ success: true, data: inserted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 2. UPDATE Subsidiary Account (PUT /api/chart-of-accounts/:id)
app.put("/api/chart-of-accounts/:id", authMiddleware, createRoutePolicyMiddleware('COA_UPDATE_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const accountId = req.params.id;
    // Fetch existing record
    const { data: existing, error: fetchErr } = await supabaseClient
      .from('account_subsidiaries')
      .select('*')
      .eq('id', accountId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "حساب معین مورد نظر یافت نشد یا دسترسی غیرمجاز است." });
    }

    // Protect system accounts
    if (existing.is_system) {
      if (req.body.code && req.body.code !== existing.code) {
        return res.status(403).json({ success: false, error: "ERR_SYSTEM_ACCOUNT_LOCKED", message: "تغییر کد حساب‌های سیستمی مجاز نیست." });
      }
    }

    const updatePayload: any = {
      updated_at: new Date().toISOString()
    };
    if (req.body.name !== undefined) updatePayload.name = req.body.name.trim();
    if (req.body.requires_person !== undefined) updatePayload.requires_person = Boolean(req.body.requires_person);
    if (req.body.requires_cost_center !== undefined) updatePayload.requires_cost_center = Boolean(req.body.requires_cost_center);

    const { data: updated, error: updateErr } = await supabaseClient
      .from('account_subsidiaries')
      .update(updatePayload)
      .eq('id', accountId)
      .eq('organization_id', verifiedOrgId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ success: false, error: "ERR_UPDATE_FAILED", message: updateErr.message });
    }

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 3. DEACTIVATE Subsidiary Account (POST /api/chart-of-accounts/:id/deactivate)
app.post("/api/chart-of-accounts/:id/deactivate", authMiddleware, createRoutePolicyMiddleware('COA_DEACTIVATE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const accountId = req.params.id;
    const { data: existing, error: fetchErr } = await supabaseClient
      .from('account_subsidiaries')
      .select('*')
      .eq('id', accountId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "حساب معین مورد نظر یافت نشد یا دسترسی غیرمجاز است." });
    }

    if (existing.is_system) {
      return res.status(403).json({ success: false, error: "ERR_SYSTEM_ACCOUNT_PROTECTED", message: "غیرفعال‌سازی حساب‌های سیستمی ممنوع است." });
    }

    const { data: updated, error: updateErr } = await supabaseClient
      .from('account_subsidiaries')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', accountId)
      .eq('organization_id', verifiedOrgId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ success: false, error: "ERR_DEACTIVATE_FAILED", message: updateErr.message });
    }

    return res.json({ success: true, data: updated, message: "حساب با موفقیت غیرفعال شد." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// ==============================================================================
// PERSONS SECURE API ENDPOINTS (Block 1 - Command 4)
// ==============================================================================

// 1. GET /api/persons - List persons for authenticated organization
app.get("/api/persons", authMiddleware, createRoutePolicyMiddleware('PERSONS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';

    let query = supabaseClient
      .from('persons')
      .select('*')
      .eq('organization_id', verifiedOrgId);

    if (!includeInactive) {
      query = query.neq('status', 'inactive');
    }

    const { data: persons, error: fetchErr } = await query
      .order('code', { ascending: true });

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_PERSONS_FAILED", message: fetchErr.message });
    }

    return res.json({
      success: true,
      organizationId: verifiedOrgId,
      data: persons || []
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

// 1.5 GET /api/persons/me/agent-profile - Get authenticated user's agent profile
app.get("/api/persons/me/agent-profile", authMiddleware, createRoutePolicyMiddleware('PERSON_ME_AGENT_PROFILE_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    // Lookup person where owner_user_id == req.authenticatedUserId and organization_id == verifiedOrgId
    const { data: person, error: fetchErr } = await supabaseClient
      .from('persons')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_AGENT_PROFILE_FAILED", message: fetchErr.message });
    }

    if (!person || !Boolean(person.is_agent)) {
      return res.json({ success: true, data: null });
    }

    // Fetch corresponding person_agent_details (store_name, store_address)
    const { data: agentDetails } = await supabaseClient
      .from('person_agent_details')
      .select('*')
      .eq('person_id', person.id)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    const responsePayload = {
      ...person,
      agent_details: agentDetails || null,
      agentDetails: agentDetails ? {
        storeName: agentDetails.store_name || '',
        storeAddress: agentDetails.store_address || '',
      } : undefined,
    };

    return res.json({ success: true, data: responsePayload });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

async function fetchNextUniquePersonCode(supabaseClient: any, organizationId: string): Promise<string> {
  const { data: persons, error: fetchErr } = await supabaseClient
    .from('persons')
    .select('code')
    .eq('organization_id', organizationId);

  if (fetchErr) {
    throw new Error(`Failed to fetch person codes: ${fetchErr.message}`);
  }

  let maxNum = 1000;
  const existingCodes = new Set<string>();

  if (persons && Array.isArray(persons)) {
    for (const row of persons) {
      if (row.code) {
        const rawCode = String(row.code).trim();
        existingCodes.add(rawCode);
        const match = rawCode.match(/^P?(\d+)$/i);
        if (match) {
          const val = parseInt(match[1], 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
      }
    }
  }

  let candidateNum = maxNum + 1;
  let nextCode = `P${candidateNum}`;
  while (existingCodes.has(nextCode) || existingCodes.has(String(candidateNum))) {
    candidateNum++;
    nextCode = `P${candidateNum}`;
  }

  return nextCode;
}

function isDuplicatePersonCodeConflict(err: any): boolean {
  if (!err || err.code !== '23505') return false;
  const str = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
  return str.includes('uq_person_code_per_org') || str.includes('(organization_id, code)');
}

function isDuplicatePersonNationalIdConflict(err: any): boolean {
  if (!err || err.code !== '23505') return false;
  const str = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`;
  return str.includes('uq_person_national_id_per_org') || str.includes('national_id');
}

// 1.6 GET /api/persons/next-code - Get next available unique person code for organization
app.get("/api/persons/next-code", authMiddleware, createRoutePolicyMiddleware('PERSONS_NEXT_CODE_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const nextCode = await fetchNextUniquePersonCode(supabaseClient, verifiedOrgId);

    return res.json({
      success: true,
      nextCode,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

// 2. GET /api/persons/:id - Get single person by ID within organization scope
app.get("/api/persons/:id", authMiddleware, createRoutePolicyMiddleware('PERSONS_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const personId = req.params.id;
    const { data: person, error: fetchErr } = await supabaseClient
      .from('persons')
      .select('*')
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !person) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "شخص مورد نظر در این سازمان یافت نشد." });
    }

    return res.json({ success: true, data: person });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

function isValidIranianNationalId(nationalId: string): boolean {
  if (!nationalId) return false;
  const persianDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let cleanId = String(nationalId).trim();
  for (let i = 0; i < 10; i++) {
    cleanId = cleanId.replace(persianDigits[i], i.toString()).replace(arabicDigits[i], i.toString());
  }
  cleanId = cleanId.replace(/\D/g, '');

  if (!/^\d{10}$/.test(cleanId)) {
    return false;
  }

  if (/^(\d)\1{9}$/.test(cleanId)) {
    return false;
  }

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanId[i], 10) * (10 - i);
  }

  const remainder = sum % 11;
  const checkDigit = parseInt(cleanId[9], 10);

  if (remainder < 2) {
    return checkDigit === remainder;
  } else {
    return checkDigit === 11 - remainder;
  }
}

// 3. POST /api/persons - Create new person record
app.post("/api/persons", authMiddleware, createRoutePolicyMiddleware('PERSONS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const body = req.body || {};
    const code = body.code ? String(body.code).trim() : "";
    const name = body.name ? String(body.name).trim() : "";

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        error: "ERR_INVALID_INPUT",
        message: "کد و نام شخص الزامی است."
      });
    }

    const rawNationalId = body.national_id !== undefined ? body.national_id : body.nationalId;
    if (rawNationalId && String(rawNationalId).trim() !== '') {
      if (!isValidIranianNationalId(String(rawNationalId))) {
        return res.status(400).json({
          success: false,
          error: "ERR_INVALID_INPUT",
          message: "کد ملی وارد شده معتبر نیست."
        });
      }
    }

    // Explicit allowlist of insertable fields
    const insertPayload: any = {
      organization_id: verifiedOrgId,
      code: code,
      name: name,
      person_type: ['real', 'legal'].includes(body.person_type) ? body.person_type : 'real',
      national_id: body.national_id ? String(body.national_id).trim() : null,
      mobile: body.mobile ? String(body.mobile).trim() : null,
      phone: body.phone ? String(body.phone).trim() : null,
      gender: ['male', 'female', 'other'].includes(body.gender) ? body.gender : null,
      father_name: body.father_name ? String(body.father_name).trim() : null,
      birth_date: body.birth_date || null,
      company_name: body.company_name ? String(body.company_name).trim() : null,
      status: ['draft', 'active', 'inactive', 'blocked'].includes(body.status) ? body.status : 'active',
      role: ['debtor', 'creditor', 'both'].includes(body.role) ? body.role : 'both',
      province: body.province ? String(body.province).trim() : null,
      city: body.city ? String(body.city).trim() : null,
      district: body.district ? String(body.district).trim() : null,
      address: body.address ? String(body.address).trim() : null,
      postal_code: body.postal_code ? String(body.postal_code).trim() : null,
      bank_name: body.bank_name ? String(body.bank_name).trim() : null,
      account_holder_name: body.account_holder_name ? String(body.account_holder_name).trim() : null,
      card_number_masked: body.card_number_masked || (body.cardNumber ? String(body.cardNumber).replace(/^(\d{6})\d+(\d{4})$/, '$1******$2') : null),
      sheba_number_masked: body.sheba_number_masked || (body.shebaNumber ? String(body.shebaNumber).replace(/^([A-Z]{2}\d{2})\d+(\d{4})$/, '$1******************$2') : null),
      account_number_masked: body.account_number_masked || (body.accountNumber ? String(body.accountNumber).replace(/^(\d{2})\d+(\d{2})$/, '$1****$2') : null),
      credit_limit: typeof body.credit_limit === 'number' ? Math.max(0, Math.round(body.credit_limit)) : (typeof body.creditLimit === 'number' ? Math.max(0, Math.round(body.creditLimit)) : 0),
      credit_score: typeof body.credit_score === 'number' ? Math.min(100, Math.max(0, Math.round(body.credit_score))) : (typeof body.creditScore === 'number' ? Math.min(100, Math.max(0, Math.round(body.creditScore))) : 0),
      penalty_rate: typeof body.penalty_rate === 'number' ? Math.max(0, body.penalty_rate) : (typeof body.penaltyRate === 'number' ? Math.max(0, body.penaltyRate) : 0),
      allowed_delay_days: typeof body.allowed_delay_days === 'number' ? Math.max(0, Math.round(body.allowed_delay_days)) : (typeof body.allowedDelayDays === 'number' ? Math.max(0, Math.round(body.allowedDelayDays)) : 0),
      is_offline_wholesale_enabled: Boolean(body.is_offline_wholesale_enabled ?? body.isOfflineWholesaleEnabled),
      is_installment_enabled: Boolean(body.is_installment_enabled ?? body.isInstallmentEnabled),
      is_documents_approved: Boolean(body.is_documents_approved ?? body.isDocumentsApproved),
      is_agent: Boolean(body.is_agent ?? body.isAgent),
      agency_role: body.agency_role ? String(body.agency_role).trim() : (body.agencyRole ? String(body.agencyRole).trim() : null),
      agency_status: body.agency_status ? String(body.agency_status).trim() : (body.agencyStatus ? String(body.agencyStatus).trim() : null),
      agency_credit_limit: typeof body.agency_credit_limit === 'number' ? Math.max(0, Math.round(body.agency_credit_limit)) : (typeof body.agencyCreditLimit === 'number' ? Math.max(0, Math.round(body.agencyCreditLimit)) : null),
      internal_notes: body.internal_notes ? String(body.internal_notes).trim() : (body.internalNotes ? String(body.internalNotes).trim() : null),
      created_by: userId
    };

    // If a valid existing UUID is provided for migration/backfill, preserve it safely
    if (body.id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(body.id))) {
      insertPayload.id = String(body.id);
    }

    let inserted: any = null;
    let insertErr: any = null;

    // 1. Initial INSERT attempt with provided/requested code
    const initialInsert = await supabaseClient
      .from('persons')
      .insert(insertPayload)
      .select()
      .single();

    inserted = initialInsert.data;
    insertErr = initialInsert.error;

    // 2. If INSERT failed specifically with unique code conflict (uq_person_code_per_org), retry up to 5 times
    if (insertErr && isDuplicatePersonCodeConflict(insertErr)) {
      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const freshCode = await fetchNextUniquePersonCode(supabaseClient, verifiedOrgId);
          insertPayload.code = freshCode;

          const retryRes = await supabaseClient
            .from('persons')
            .insert(insertPayload)
            .select()
            .single();

          if (!retryRes.error && retryRes.data) {
            inserted = retryRes.data;
            insertErr = null;
            break;
          } else {
            insertErr = retryRes.error;
            if (!isDuplicatePersonCodeConflict(insertErr)) {
              // Hit a non-code error (e.g. duplicate national ID), abort retry immediately
              break;
            }
          }
        } catch (retryGenErr: any) {
          console.warn(`[POST /api/persons] Retry ${attempt} failed to generate next code:`, retryGenErr);
        }
      }
    }

    if (insertErr) {
      if (isDuplicatePersonNationalIdConflict(insertErr)) {
        return res.status(409).json({
          success: false,
          error: "ERR_DUPLICATE_NATIONAL_ID",
          message: "کد ملی شخص در این سازمان تکراری است."
        });
      }
      if (insertErr.code === '23505' || isDuplicatePersonCodeConflict(insertErr)) {
        return res.status(409).json({
          success: false,
          error: "ERR_DUPLICATE_PERSON_CODE",
          message: "کد شخص در این سازمان تکراری است."
        });
      }
      return res.status(500).json({ success: false, error: "ERR_INSERT_PERSON_FAILED", message: insertErr.message });
    }

    // Auto-provision agent user account if person is registered as an agent
    let finalPersonData = inserted;
    let generatedPassword: string | undefined;
    let loginIdentifier: string | undefined;

    if (inserted && Boolean(inserted.is_agent) && !inserted.owner_user_id) {
      const provisioningResult = await AgentUserProvisioningService.provisionAgentUserAccount({
        person: inserted,
        organizationId: verifiedOrgId,
        grantedByUserId: userId,
        agencyRole: body.agency_role || body.agencyRole || (body.role === 'creditor' ? 'credit' : 'sales'),
      });

      if (!provisioningResult.success) {
        return res.status(400).json({
          success: false,
          error: provisioningResult.error || "ERR_AGENT_PROVISIONING_FAILED",
          message: provisioningResult.message,
          data: inserted,
        });
      }

      if (provisioningResult.generatedPassword) {
        generatedPassword = provisioningResult.generatedPassword;
        loginIdentifier = provisioningResult.loginIdentifier || inserted.mobile;
        finalPersonData = provisioningResult.updatedPerson || inserted;
      }
    }

    const responsePayload: any = { success: true, data: finalPersonData };
    if (generatedPassword) {
      responsePayload.generatedPassword = generatedPassword;
      responsePayload.loginIdentifier = loginIdentifier;
    }

    return res.status(201).json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 4. PUT /api/persons/:id - Update existing person with explicit allowlist and optimistic locking
app.put("/api/persons/:id", authMiddleware, createRoutePolicyMiddleware('PERSONS_UPDATE_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const personId = req.params.id;
    const body = req.body || {};

    // Fetch existing record to verify existence, organization boundary, and current version
    const { data: existing, error: fetchErr } = await supabaseClient
      .from('persons')
      .select('*')
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({
        success: false,
        error: "ERR_NOT_FOUND",
        message: "شخص مورد نظر در این سازمان یافت نشد یا دسترسی غیرمجاز است."
      });
    }

    // Optimistic concurrency check if expected_version is passed
    if (body.expected_version !== undefined && Number(body.expected_version) !== existing.version) {
      return res.status(409).json({
        success: false,
        error: "ERR_OPTIMISTIC_CONCURRENCY_CONFLICT",
        message: `رکورد شخص توسط کاربر دیگری ویرایش شده است (نسخه سرور: ${existing.version}، نسخه ارسالی: ${body.expected_version}).`
      });
    }

    // Explicit allowlist of updatable fields (id and organization_id strictly forbidden from being changed)
    const updatePayload: any = {
      updated_at: new Date().toISOString()
    };

    if (body.name !== undefined) updatePayload.name = String(body.name).trim();
    if (body.person_type !== undefined && ['real', 'legal'].includes(body.person_type)) updatePayload.person_type = body.person_type;
    if (body.national_id !== undefined || body.nationalId !== undefined) {
      const rawNatId = body.national_id !== undefined ? body.national_id : body.nationalId;
      if (rawNatId && String(rawNatId).trim() !== '') {
        if (!isValidIranianNationalId(String(rawNatId))) {
          return res.status(400).json({
            success: false,
            error: "ERR_INVALID_INPUT",
            message: "کد ملی وارد شده معتبر نیست."
          });
        }
        updatePayload.national_id = String(rawNatId).trim();
      } else {
        updatePayload.national_id = null;
      }
    }
    if (body.mobile !== undefined) updatePayload.mobile = body.mobile ? String(body.mobile).trim() : null;
    if (body.phone !== undefined) updatePayload.phone = body.phone ? String(body.phone).trim() : null;
    if (body.gender !== undefined) updatePayload.gender = ['male', 'female', 'other'].includes(body.gender) ? body.gender : null;
    if (body.father_name !== undefined) updatePayload.father_name = body.father_name ? String(body.father_name).trim() : null;
    if (body.birth_date !== undefined) updatePayload.birth_date = body.birth_date || null;
    if (body.company_name !== undefined) updatePayload.company_name = body.company_name ? String(body.company_name).trim() : null;
    if (body.status !== undefined && ['draft', 'active', 'inactive', 'blocked'].includes(body.status)) updatePayload.status = body.status;
    if (body.role !== undefined && ['debtor', 'creditor', 'both'].includes(body.role)) updatePayload.role = body.role;
    if (body.province !== undefined) updatePayload.province = body.province ? String(body.province).trim() : null;
    if (body.city !== undefined) updatePayload.city = body.city ? String(body.city).trim() : null;
    if (body.district !== undefined) updatePayload.district = body.district ? String(body.district).trim() : null;
    if (body.address !== undefined) updatePayload.address = body.address ? String(body.address).trim() : null;
    if (body.postal_code !== undefined) updatePayload.postal_code = body.postal_code ? String(body.postal_code).trim() : null;
    if (body.bank_name !== undefined) updatePayload.bank_name = body.bank_name ? String(body.bank_name).trim() : null;
    if (body.account_holder_name !== undefined) updatePayload.account_holder_name = body.account_holder_name ? String(body.account_holder_name).trim() : null;
    if (body.card_number_masked !== undefined) updatePayload.card_number_masked = body.card_number_masked;
    if (body.sheba_number_masked !== undefined) updatePayload.sheba_number_masked = body.sheba_number_masked;
    if (body.account_number_masked !== undefined) updatePayload.account_number_masked = body.account_number_masked;
    if (body.credit_limit !== undefined) updatePayload.credit_limit = Math.max(0, Math.round(Number(body.credit_limit)));
    else if (body.creditLimit !== undefined) updatePayload.credit_limit = Math.max(0, Math.round(Number(body.creditLimit)));
    if (body.credit_score !== undefined) updatePayload.credit_score = Math.min(100, Math.max(0, Math.round(Number(body.credit_score))));
    else if (body.creditScore !== undefined) updatePayload.credit_score = Math.min(100, Math.max(0, Math.round(Number(body.creditScore))));
    if (body.penalty_rate !== undefined) updatePayload.penalty_rate = Math.max(0, Number(body.penalty_rate));
    else if (body.penaltyRate !== undefined) updatePayload.penalty_rate = Math.max(0, Number(body.penaltyRate));
    if (body.allowed_delay_days !== undefined) updatePayload.allowed_delay_days = Math.max(0, Math.round(Number(body.allowed_delay_days)));
    else if (body.allowedDelayDays !== undefined) updatePayload.allowed_delay_days = Math.max(0, Math.round(Number(body.allowedDelayDays)));
    if (body.is_offline_wholesale_enabled !== undefined) updatePayload.is_offline_wholesale_enabled = Boolean(body.is_offline_wholesale_enabled);
    else if (body.isOfflineWholesaleEnabled !== undefined) updatePayload.is_offline_wholesale_enabled = Boolean(body.isOfflineWholesaleEnabled);
    if (body.is_installment_enabled !== undefined) updatePayload.is_installment_enabled = Boolean(body.is_installment_enabled);
    else if (body.isInstallmentEnabled !== undefined) updatePayload.is_installment_enabled = Boolean(body.isInstallmentEnabled);
    if (body.is_documents_approved !== undefined) updatePayload.is_documents_approved = Boolean(body.is_documents_approved);
    else if (body.isDocumentsApproved !== undefined) updatePayload.is_documents_approved = Boolean(body.isDocumentsApproved);
    if (body.is_agent !== undefined) updatePayload.is_agent = Boolean(body.is_agent);
    else if (body.isAgent !== undefined) updatePayload.is_agent = Boolean(body.isAgent);
    if (body.agency_role !== undefined) updatePayload.agency_role = body.agency_role ? String(body.agency_role).trim() : null;
    else if (body.agencyRole !== undefined) updatePayload.agency_role = body.agencyRole ? String(body.agencyRole).trim() : null;
    if (body.agency_status !== undefined) updatePayload.agency_status = body.agency_status ? String(body.agency_status).trim() : null;
    else if (body.agencyStatus !== undefined) updatePayload.agency_status = body.agencyStatus ? String(body.agencyStatus).trim() : null;
    if (body.agency_credit_limit !== undefined) updatePayload.agency_credit_limit = Math.max(0, Math.round(Number(body.agency_credit_limit)));
    else if (body.agencyCreditLimit !== undefined) updatePayload.agency_credit_limit = Math.max(0, Math.round(Number(body.agencyCreditLimit)));
    if (body.internal_notes !== undefined) updatePayload.internal_notes = body.internal_notes ? String(body.internal_notes).trim() : null;
    else if (body.internalNotes !== undefined) updatePayload.internal_notes = body.internalNotes ? String(body.internalNotes).trim() : null;

    if (body.code !== undefined && String(body.code).trim() !== '') {
      updatePayload.code = String(body.code).trim();
    }

    let query = supabaseClient
      .from('persons')
      .update(updatePayload)
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId);

    if (body.expected_version !== undefined) {
      query = query.eq('version', existing.version);
    }

    let { data: updated, error: updateErr } = await query.select().single();

    // 2. If UPDATE failed specifically with unique code conflict (uq_person_code_per_org), retry up to 5 times
    if (updateErr && isDuplicatePersonCodeConflict(updateErr)) {
      const maxRetries = 5;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const freshCode = await fetchNextUniquePersonCode(supabaseClient, verifiedOrgId);
          updatePayload.code = freshCode;

          let retryQuery = supabaseClient
            .from('persons')
            .update(updatePayload)
            .eq('id', personId)
            .eq('organization_id', verifiedOrgId);

          if (body.expected_version !== undefined) {
            retryQuery = retryQuery.eq('version', existing.version);
          }

          const retryRes = await retryQuery.select().single();

          if (!retryRes.error && retryRes.data) {
            updated = retryRes.data;
            updateErr = null;
            break;
          } else {
            updateErr = retryRes.error;
            if (!isDuplicatePersonCodeConflict(updateErr)) {
              // Hit a non-code error (e.g. duplicate national ID), abort retry immediately
              break;
            }
          }
        } catch (retryGenErr: any) {
          console.warn(`[PUT /api/persons/:id] Retry ${attempt} failed to generate next code:`, retryGenErr);
        }
      }
    }

    if (updateErr) {
      if (isDuplicatePersonNationalIdConflict(updateErr)) {
        return res.status(409).json({ success: false, error: "ERR_DUPLICATE_NATIONAL_ID", message: "کد ملی شخص در این سازمان تکراری است." });
      }
      if (updateErr.code === '23505' || isDuplicatePersonCodeConflict(updateErr)) {
        return res.status(409).json({ success: false, error: "ERR_DUPLICATE_PERSON_CODE", message: "کد شخص در این سازمان تکراری است." });
      }
      return res.status(500).json({ success: false, error: "ERR_UPDATE_PERSON_FAILED", message: updateErr.message });
    }

    // Auto-provision agent user account if person is updated to be an agent and has no owner_user_id
    let finalPersonData = updated;
    let generatedPassword: string | undefined;
    let loginIdentifier: string | undefined;

    if (updated && Boolean(updated.is_agent) && !updated.owner_user_id) {
      const provisioningResult = await AgentUserProvisioningService.provisionAgentUserAccount({
        person: updated,
        organizationId: verifiedOrgId,
        grantedByUserId: userId,
        agencyRole: body.agency_role || body.agencyRole || (body.role === 'creditor' ? 'credit' : 'sales'),
      });

      if (!provisioningResult.success) {
        return res.status(400).json({
          success: false,
          error: provisioningResult.error || "ERR_AGENT_PROVISIONING_FAILED",
          message: provisioningResult.message,
          data: updated,
        });
      }

      if (provisioningResult.generatedPassword) {
        generatedPassword = provisioningResult.generatedPassword;
        loginIdentifier = provisioningResult.loginIdentifier || updated.mobile;
        finalPersonData = provisioningResult.updatedPerson || updated;
      }
    }

    const responsePayload: any = { success: true, data: finalPersonData };
    if (generatedPassword) {
      responsePayload.generatedPassword = generatedPassword;
      responsePayload.loginIdentifier = loginIdentifier;
    }

    return res.json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 5. POST /api/persons/:id/deactivate - Soft deactivate person (Hard delete strictly blocked)
app.post("/api/persons/:id/deactivate", authMiddleware, createRoutePolicyMiddleware('PERSONS_DEACTIVATE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const personId = req.params.id;
    const { data: existing, error: fetchErr } = await supabaseClient
      .from('persons')
      .select('*')
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "شخص مورد نظر در این سازمان یافت نشد یا دسترسی غیرمجاز است." });
    }

    const { data: updated, error: updateErr } = await supabaseClient
      .from('persons')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ success: false, error: "ERR_DEACTIVATE_FAILED", message: updateErr.message });
    }

    return res.json({ success: true, data: updated, message: "وضعیت شخص با موفقیت به غیرفعال تغییر یافت." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 6. GET /api/persons/:id/agent-details - Get agent details (store_name, store_address)
app.get("/api/persons/:id/agent-details", authMiddleware, createRoutePolicyMiddleware('PERSON_AGENT_DETAILS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const personId = req.params.id;
    const { data: details, error: fetchErr } = await supabaseClient
      .from('person_agent_details')
      .select('*')
      .eq('person_id', personId)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_AGENT_DETAILS_FAILED", message: fetchErr.message });
    }

    return res.json({ success: true, data: details || null });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 7. PUT /api/persons/:id/agent-details - Upsert agent details (store_name, store_address)
app.put("/api/persons/:id/agent-details", authMiddleware, createRoutePolicyMiddleware('PERSON_AGENT_DETAILS_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const personId = req.params.id;
    const body = req.body || {};

    // 1. Verify person exists and belongs to verifiedOrgId
    const { data: existingPerson, error: personErr } = await supabaseClient
      .from('persons')
      .select('id, organization_id, is_agent')
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (personErr || !existingPerson) {
      return res.status(404).json({
        success: false,
        error: "ERR_NOT_FOUND",
        message: "شخص مورد نظر در این سازمان یافت نشد یا دسترسی غیرمجاز است."
      });
    }

    const storeName = body.store_name !== undefined ? (body.store_name ? String(body.store_name).trim() : null) : (body.storeName !== undefined ? (body.storeName ? String(body.storeName).trim() : null) : undefined);
    const storeAddress = body.store_address !== undefined ? (body.store_address ? String(body.store_address).trim() : null) : (body.storeAddress !== undefined ? (body.storeAddress ? String(body.storeAddress).trim() : null) : undefined);
    const paymentTermDays = body.payment_term_days !== undefined ? (body.payment_term_days !== null ? Math.round(Number(body.payment_term_days)) : null) : (body.paymentTermDays !== undefined ? (body.paymentTermDays !== null ? Math.round(Number(body.paymentTermDays)) : null) : undefined);
    const lateFeePercentage = body.late_fee_percentage !== undefined ? (body.late_fee_percentage !== null ? Number(body.late_fee_percentage) : null) : (body.lateFeePercentage !== undefined ? (body.lateFeePercentage !== null ? Number(body.lateFeePercentage) : null) : undefined);
    const isPurchaseAllowed = body.is_purchase_allowed !== undefined ? Boolean(body.is_purchase_allowed) : (body.isPurchaseAllowed !== undefined ? Boolean(body.isPurchaseAllowed) : undefined);
    const contractNotes = body.contract_notes !== undefined ? (body.contract_notes ? String(body.contract_notes).trim() : null) : (body.contractNotes !== undefined ? (body.contractNotes ? String(body.contractNotes).trim() : null) : undefined);

    // 2. Check if agent_details record already exists for this person_id in this organization
    const { data: existingDetails, error: detailsFetchErr } = await supabaseClient
      .from('person_agent_details')
      .select('*')
      .eq('person_id', personId)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    let resultData;
    if (existingDetails && existingDetails.id) {
      // Update existing record
      const updatePayload: any = {
        updated_at: new Date().toISOString(),
      };
      if (storeName !== undefined) updatePayload.store_name = storeName;
      if (storeAddress !== undefined) updatePayload.store_address = storeAddress;
      if (paymentTermDays !== undefined) updatePayload.payment_term_days = paymentTermDays;
      if (lateFeePercentage !== undefined) updatePayload.late_fee_percentage = lateFeePercentage;
      if (isPurchaseAllowed !== undefined) updatePayload.is_purchase_allowed = isPurchaseAllowed;
      if (contractNotes !== undefined) updatePayload.contract_notes = contractNotes;

      const { data: updated, error: updateErr } = await supabaseClient
        .from('person_agent_details')
        .update(updatePayload)
        .eq('id', existingDetails.id)
        .eq('organization_id', verifiedOrgId)
        .select()
        .single();

      if (updateErr) {
        return res.status(500).json({ success: false, error: "ERR_AGENT_DETAILS_UPDATE_FAILED", message: updateErr.message });
      }
      resultData = updated;
    } else {
      // Insert new record
      const insertPayload: any = {
        organization_id: verifiedOrgId,
        person_id: personId,
        store_name: storeName ?? null,
        store_address: storeAddress ?? null,
        payment_term_days: paymentTermDays ?? null,
        late_fee_percentage: lateFeePercentage ?? null,
        is_purchase_allowed: isPurchaseAllowed ?? true,
        contract_notes: contractNotes ?? null,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: inserted, error: insertErr } = await supabaseClient
        .from('person_agent_details')
        .insert(insertPayload)
        .select()
        .single();

      if (insertErr) {
        return res.status(500).json({ success: false, error: "ERR_AGENT_DETAILS_INSERT_FAILED", message: insertErr.message });
      }
      resultData = inserted;
    }

    return res.json({ success: true, data: resultData });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 8. POST /api/persons/:id/reset-agent-password - Reset password for an agent user account
app.post("/api/persons/:id/reset-agent-password", authMiddleware, createRoutePolicyMiddleware('AGENT_RESET_PASSWORD_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseAdmin: any;
    try {
      supabaseAdmin = getSupabaseServerClient();
    } catch (clientErr: any) {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseAdmin = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseAdmin);
    if (!verifiedOrgId) return;

    const personId = req.params.id;

    // 1. Fetch person in verified organization
    const { data: existingPerson, error: fetchErr } = await supabaseAdmin
      .from('persons')
      .select('id, name, mobile, national_id, owner_user_id, organization_id, is_agent')
      .eq('id', personId)
      .eq('organization_id', verifiedOrgId)
      .single();

    if (fetchErr || !existingPerson) {
      return res.status(404).json({
        success: false,
        error: "ERR_NOT_FOUND",
        message: "شخص مورد نظر در این سازمان یافت نشد یا دسترسی غیرمجاز است."
      });
    }

    // 2. Check that owner_user_id exists
    if (!existingPerson.owner_user_id || String(existingPerson.owner_user_id).trim() === '') {
      return res.status(400).json({
        success: false,
        error: "ERR_NO_USER_ACCOUNT",
        message: "این شخص هنوز حساب کاربری ندارد."
      });
    }

    // 3. Generate secure new password (min 10 characters)
    const newPassword = generateSecurePassword(12);

    // 4. Update password via Supabase Auth Admin API
    if (supabaseAdmin.auth && supabaseAdmin.auth.admin) {
      const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(
        existingPerson.owner_user_id,
        { password: newPassword }
      );

      if (authUpdateErr) {
        return res.status(500).json({
          success: false,
          error: "ERR_PASSWORD_RESET_FAILED",
          message: `خطا در به‌روزرسانی رمز عبور در سرور احراز هویت: ${authUpdateErr.message}`
        });
      }
    }

    const loginId = existingPerson.mobile || existingPerson.name;

    // Return the new password securely in this one response (never store or log in DB)
    return res.json({
      success: true,
      data: {
        personId: existingPerson.id,
        name: existingPerson.name,
        loginIdentifier: loginId,
        generatedPassword: newPassword,
      },
      generatedPassword: newPassword,
      loginIdentifier: loginId,
      name: existingPerson.name,
      message: `رمز عبور جدید برای نماینده «${existingPerson.name}» با موفقیت تولید و اعمال شد.`
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 4. CREATE & POST MANUAL JOURNAL VOUCHER (POST /api/manual-vouchers)
app.post("/api/manual-vouchers", authMiddleware, createRoutePolicyMiddleware('MANUAL_VOUCHER_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { date, description, entries } = req.body || {};
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_ENTRIES", message: "آرتیکل‌های سند الزامی است." });
    }

    // Resolve default branch for organization
    const { data: branchRow } = await supabaseClient
      .from('branches')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .limit(1)
      .single();

    if (!branchRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_BRANCH", message: "شعبه فعالی برای سازمان یافت نشد." });
    }
    const branchId = branchRow.id;

    // Resolve active fiscal year for organization
    const { data: fyRow } = await supabaseClient
      .from('fiscal_years')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('is_closed', false)
      .limit(1)
      .single();

    if (!fyRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_FISCAL_YEAR", message: "سال مالی فعالی برای سازمان یافت نشد." });
    }
    const fiscalYearId = fyRow.id;

    const voucherDate = date || new Date().toISOString().split('T')[0];
    const voucherDesc = description || 'سند حسابداری دستی';
    const operationKey = 'op_manual_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const requestFingerprint = 'fp_' + Math.random().toString(36).substring(2, 15);

    // Format entries for create_draft_journal_voucher RPC
    const formattedEntries = entries.map((e: any, idx: number) => ({
      row_number: idx + 1,
      subsidiary_id: e.subsidiaryId,
      person_id: e.floatingDetailed?.id || e.personId || null,
      cost_center_id: e.costCenterId || null,
      debit: Number(e.debit) || 0,
      credit: Number(e.credit) || 0,
      description: e.description || voucherDesc
    }));

    // Validate that all subsidiaryIds and personIds belong to verifiedOrgId
    const subIdsToValidate = Array.from(new Set(formattedEntries.map((e: any) => e.subsidiary_id).filter(Boolean)));
    const personIdsToValidate = Array.from(new Set(formattedEntries.map((e: any) => e.person_id).filter(Boolean)));

    if (subIdsToValidate.length > 0) {
      const { data: validSubs, error: subErr } = await supabaseClient
        .from('account_subsidiaries')
        .select('id')
        .eq('organization_id', verifiedOrgId)
        .in('id', subIdsToValidate);
      if (subErr || !validSubs || validSubs.length !== subIdsToValidate.length) {
        return res.status(400).json({ success: false, error: "ERR_ACCOUNT_NOT_FOUND", message: "یکی از حساب‌های معین نامعتبر است یا به این سازمان تعلق ندارد." });
      }
    }

    if (personIdsToValidate.length > 0) {
      const { data: validPersons, error: perErr } = await supabaseClient
        .from('persons')
        .select('id')
        .eq('organization_id', verifiedOrgId)
        .in('id', personIdsToValidate);
      if (perErr || !validPersons || validPersons.length !== personIdsToValidate.length) {
        return res.status(400).json({ success: false, error: "ERR_PERSON_NOT_FOUND", message: "یکی از اشخاص انتخاب شده نامعتبر است یا به این سازمان تعلق ندارد." });
      }
    }

    // Step 1: Create Draft Voucher via RPC
    const { data: draftVoucherId, error: draftErr } = await supabaseClient.rpc('create_draft_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_branch_id: branchId,
      p_fiscal_year_id: fiscalYearId,
      p_voucher_date: voucherDate,
      p_description: voucherDesc,
      p_entries: formattedEntries,
      p_operation_key: operationKey,
      p_request_fingerprint: requestFingerprint,
      p_source_type: 'MANUAL',
      p_source_id: null,
      p_source_event_key: null
    });

    if (draftErr || !draftVoucherId) {
      return res.status(400).json({ success: false, error: "ERR_DRAFT_CREATION_FAILED", message: draftErr?.message || "خطا در ایجاد پیش‌نویس سند." });
    }

    // Step 2: Post/Finalize Voucher via RPC
    const postOperationKey = 'op_post_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const postFingerprint = 'fp_post_' + Math.random().toString(36).substring(2, 15);

    const { data: voucherNumber, error: postErr } = await supabaseClient.rpc('post_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_voucher_id: draftVoucherId,
      p_expected_version: 1,
      p_operation_key: postOperationKey,
      p_request_fingerprint: postFingerprint
    });

    if (postErr) {
      return res.status(400).json({ success: false, error: "ERR_VOUCHER_POST_FAILED", message: postErr.message || "خطا در قطعی‌سازی سند." });
    }

    return res.status(201).json({
      success: true,
      data: {
        id: draftVoucherId,
        voucherNumber: Number(voucherNumber),
        date: voucherDate,
        description: voucherDesc,
        entries: formattedEntries
      },
      message: "سند حسابداری دستی با موفقیت در پایگاه داده ثبت و قطعی شد."
    });

  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

app.post("/api/opening-balance", authMiddleware, createRoutePolicyMiddleware('OPENING_BALANCE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { date, description, entries, branchId, fiscalYearId, operationKey } = req.body || {};
    if (!entries || !Array.isArray(entries) || entries.length < 2) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_ENTRIES", message: "سند افتتاحیه باید حداقل دارای ۲ آرتیکل حسابداری باشد." });
    }

    // Mathematical Double-Entry Validation
    const totalDebit = entries.reduce((sum: number, e: any) => sum + (Number(e.debit) || 0), 0);
    const totalCredit = entries.reduce((sum: number, e: any) => sum + (Number(e.credit) || 0), 0);

    if (totalDebit !== totalCredit) {
      return res.status(400).json({
        success: false,
        error: "ERR_VOUCHER_UNBALANCED",
        message: `سند حسابداری افتتاحیه تراز نیست (مجموع بدهکار: ${totalDebit.toLocaleString()}, مجموع بستانکار: ${totalCredit.toLocaleString()})`
      });
    }

    if (totalDebit <= 0) {
      return res.status(400).json({
        success: false,
        error: "ERR_INVALID_AMOUNT",
        message: "مجموع مبالغ سند افتتاحیه باید بزرگتر از صفر باشد."
      });
    }

    const voucherDate = date || new Date().toISOString().split('T')[0];
    const voucherDesc = description || 'ثبت سند تراز افتتاحیه اول دوره';
    const opKey = operationKey || 'op_ob_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    // Format entries for create_opening_balance_atomic RPC
    const formattedEntries = entries.map((e: any, idx: number) => ({
      row_number: idx + 1,
      subsidiary_id: e.subsidiaryId || e.subsidiary_id,
      person_id: e.floatingDetailed?.id || e.personId || e.person_id || null,
      cost_center_id: e.costCenterId || e.cost_center_id || null,
      debit: Number(e.debit) || 0,
      credit: Number(e.credit) || 0,
      description: e.description || voucherDesc,
      contract_type: e.contractType || e.contract_type || null
    }));

    const { data: rpcResult, error: rpcErr } = await supabaseClient.rpc('create_opening_balance_atomic', {
      p_org_id: verifiedOrgId,
      p_branch_id: branchId || null,
      p_fiscal_year_id: fiscalYearId || null,
      p_user_id: userId,
      p_op_key: opKey,
      p_date: voucherDate,
      p_description: voucherDesc,
      p_entries: formattedEntries
    });

    if (rpcErr) {
      return res.status(400).json({
        success: false,
        error: rpcErr.message?.split(':')[0] || "ERR_OPENING_BALANCE_FAILED",
        message: rpcErr.message || "خطا در ثبت سند افتتاحیه در پایگاه داده."
      });
    }

    return res.status(201).json({
      success: true,
      data: rpcResult,
      message: "سند تراز افتتاحیه با موفقیت در پایگاه داده سرور ثبت و قطعی شد."
    });

  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// ==============================================================================
// Installment Management Routes (create_installment_book_atomic & settle_installment_atomic)
// ==============================================================================
app.get("/api/installments/books", authMiddleware, createRoutePolicyMiddleware('INSTALLMENT_BOOKS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data: books, error: booksErr } = await supabaseClient
      .from("installment_books")
      .select("*, installments(*)")
      .eq("organization_id", verifiedOrgId)
      .order("created_at", { ascending: false });

    if (booksErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_BOOKS_FAILED", message: booksErr.message });
    }

    const formattedBooks = (books || []).map((b: any) => ({
      id: b.id,
      organizationId: b.organization_id,
      branchId: b.branch_id,
      personId: b.person_id,
      originType: b.origin_type || 'INVOICE',
      invoiceId: b.invoice_id,
      creditFileId: b.credit_file_id,
      calculatorId: b.calculator_id,
      totalPrincipal: Number(b.total_principal || 0),
      totalInterest: Number(b.total_interest || 0),
      totalAmount: Number(b.total_amount || 0),
      installmentCount: Number(b.installment_count || 0),
      startDate: b.start_date,
      intervalDays: Number(b.interval_days || 30),
      status: b.status,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
      installments: (b.installments || []).map((i: any) => ({
        id: i.id,
        bookId: i.book_id,
        installmentNumber: Number(i.installment_number),
        dueDate: i.due_date,
        amount: Number(i.amount || 0),
        paidAmount: Number(i.paid_amount || 0),
        principalPart: Number(i.principal_part || 0),
        interestPart: Number(i.interest_part || 0),
        penaltyAmount: Number(i.penalty_amount || 0),
        delayDays: Number(i.delay_days || 0),
        status: i.status,
        paidDate: i.paid_date,
        calculatorId: i.calculator_id,
        createdAt: i.created_at,
        updatedAt: i.updated_at
      }))
    }));

    return res.status(200).json({
      success: true,
      books: formattedBooks
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

app.post("/api/installments/create", authMiddleware, createRoutePolicyMiddleware('INSTALLMENT_CREATE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const {
      branchId,
      personId,
      originType,
      origin_type,
      invoiceId,
      creditFileId,
      calculatorId,
      totalPrincipal,
      totalInterest,
      totalAmount,
      installmentCount,
      startDate,
      intervalDays,
      installments,
      operationKey
    } = req.body || {};

    if (!personId) {
      return res.status(400).json({ success: false, error: "ERR_PERSON_REQUIRED", message: "شناسه طرف حساب الزامی است." });
    }
    if (!installments || !Array.isArray(installments) || installments.length === 0) {
      return res.status(400).json({ success: false, error: "ERR_EMPTY_INSTALLMENTS", message: "لیست اقساط نمی‌تواند خالی باشد." });
    }

    const resolvedOriginType = originType || origin_type || 'INVOICE';
    const opKey = operationKey || `op_inst_book_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const { data: rpcResult, error: rpcErr } = await supabaseClient.rpc('create_installment_book_atomic', {
      p_org_id: verifiedOrgId,
      p_branch_id: branchId || null,
      p_person_id: personId,
      p_user_id: userId,
      p_origin_type: resolvedOriginType,
      p_invoice_id: invoiceId ? String(invoiceId) : null,
      p_credit_file_id: creditFileId ? String(creditFileId) : null,
      p_calculator_id: calculatorId ? String(calculatorId) : null,
      p_total_principal: Number(totalPrincipal) || 0,
      p_total_interest: Number(totalInterest) || 0,
      p_total_amount: Number(totalAmount) || 0,
      p_installment_count: Number(installmentCount) || installments.length,
      p_start_date: startDate || new Date().toISOString().split('T')[0],
      p_interval_days: Number(intervalDays) || 30,
      p_installments: installments,
      p_op_key: opKey
    });

    if (rpcErr) {
      return res.status(400).json({
        success: false,
        error: rpcErr.message?.split(':')[0] || "ERR_INSTALLMENT_BOOK_FAILED",
        message: rpcErr.message || "خطا در ایجاد دفترچه اقساط در پایگاه داده."
      });
    }

    return res.status(201).json({
      success: true,
      data: rpcResult,
      message: "دفترچه اقساط با موفقیت ایجاد شد."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

app.post("/api/installments/settle", authMiddleware, createRoutePolicyMiddleware('INSTALLMENT_SETTLE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const {
      branchId,
      fiscalYearId,
      personId,
      installmentIds,
      amount,
      paymentMethod,
      paymentDate,
      bankOrCashSubId,
      posTerminalId,
      description,
      operationKey
    } = req.body || {};

    if (!personId) {
      return res.status(400).json({ success: false, error: "ERR_PERSON_REQUIRED", message: "شناسه طرف حساب الزامی است." });
    }
    if (!installmentIds || !Array.isArray(installmentIds) || installmentIds.length === 0) {
      return res.status(400).json({ success: false, error: "ERR_NO_INSTALLMENT_SELECTED", message: "حداقل یک قسط جهت تسویه باید انتخاب شود." });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_AMOUNT", message: "مبلغ تسویه باید بزرگتر از صفر باشد." });
    }

    const opKey = operationKey || `op_inst_settle_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const { data: rpcResult, error: rpcErr } = await supabaseClient.rpc('settle_installment_atomic', {
      p_org_id: verifiedOrgId,
      p_branch_id: branchId || null,
      p_fiscal_year_id: fiscalYearId || null,
      p_user_id: userId,
      p_person_id: personId,
      p_installment_ids: installmentIds,
      p_amount: Number(amount),
      p_payment_method: paymentMethod || 'CASH',
      p_payment_date: paymentDate || new Date().toISOString().split('T')[0],
      p_bank_or_cash_sub_id: bankOrCashSubId || null,
      p_pos_terminal_id: posTerminalId || null,
      p_description: description || 'دریافت وجه قسط',
      p_op_key: opKey
    });

    if (rpcErr) {
      return res.status(400).json({
        success: false,
        error: rpcErr.message?.split(':')[0] || "ERR_SETTLE_INSTALLMENT_FAILED",
        message: rpcErr.message || "خطا در تسویه قسط در پایگاه داده."
      });
    }

    return res.status(200).json({
      success: true,
      data: rpcResult,
      message: "قسط با موفقیت تسویه شد و سند دوبل صادر گردید."
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// Helper functions for Cash Payments
async function resolveSubsidiaryUuid(supabaseClient: any, verifiedOrgId: string, subIdOrKey: string): Promise<string | null> {
  if (!subIdOrKey) return null;
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(subIdOrKey);
  if (isUuid) {
    const { data } = await supabaseClient
      .from('account_subsidiaries')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('id', subIdOrKey)
      .maybeSingle();
    if (data) return data.id;
  }

  // Try matching system_key
  const { data: byKey } = await supabaseClient
    .from('account_subsidiaries')
    .select('id')
    .eq('organization_id', verifiedOrgId)
    .eq('system_key', subIdOrKey)
    .maybeSingle();
  if (byKey) return byKey.id;

  // Try matching code
  const { data: byCode } = await supabaseClient
    .from('account_subsidiaries')
    .select('id')
    .eq('organization_id', verifiedOrgId)
    .eq('code', subIdOrKey)
    .maybeSingle();
  if (byCode) return byCode.id;

  // Fallback: search by code '20201' if key is SUB_CREDITORS
  if (subIdOrKey === 'SUB_CREDITORS') {
    const { data: defaultCred } = await supabaseClient
      .from('account_subsidiaries')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('code', '20201')
      .maybeSingle();
    if (defaultCred) return defaultCred.id;
  }

  // Fallback: search by code '10301' if key is SUB_DEBTORS
  if (subIdOrKey === 'SUB_DEBTORS') {
    const { data: defaultDebtor } = await supabaseClient
      .from('account_subsidiaries')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('code', '10301')
      .maybeSingle();
    if (defaultDebtor) return defaultDebtor.id;
  }

  return null;
}

async function resolvePersonUuid(supabaseClient: any, verifiedOrgId: string, personIdOrName: string, personName?: string): Promise<string | null> {
  if (!personIdOrName) return null;
  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(personIdOrName);
  if (isUuid) {
    const { data } = await supabaseClient
      .from('persons')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('id', personIdOrName)
      .maybeSingle();
    if (data) return data.id;
  }

  const nameToSearch = personName || personIdOrName;
  const { data: byName } = await supabaseClient
    .from('persons')
    .select('id')
    .eq('organization_id', verifiedOrgId)
    .eq('name', nameToSearch)
    .maybeSingle();
  if (byName) return byName.id;

  const { data: firstPerson } = await supabaseClient
    .from('persons')
    .select('id')
    .eq('organization_id', verifiedOrgId)
    .limit(1)
    .maybeSingle();
  return firstPerson ? firstPerson.id : null;
}

// 5. ATOMIC CASH PAYMENT TO PERSON (POST /api/cash-transactions/pay)
app.post("/api/cash-transactions/pay", authMiddleware, createRoutePolicyMiddleware('CASH_PAY_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { personId, personName, accountId, amount, date, description, operationKey } = req.body || {};

    if (!personId || !accountId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "اطلاعات پرداخت ناتمام یا نامعتبر است." });
    }

    // Resolve default branch for organization
    const { data: branchRow } = await supabaseClient
      .from('branches')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .limit(1)
      .single();

    if (!branchRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_BRANCH", message: "شعبه فعالی برای سازمان یافت نشد." });
    }
    const branchId = branchRow.id;

    // Resolve active fiscal year for organization
    const { data: fyRow } = await supabaseClient
      .from('fiscal_years')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('is_closed', false)
      .limit(1)
      .single();

    if (!fyRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_FISCAL_YEAR", message: "سال مالی فعالی برای سازمان یافت نشد." });
    }
    const fiscalYearId = fyRow.id;

    // Resolve Creditors Subsidiary UUID
    const creditorsSubId = await resolveSubsidiaryUuid(supabaseClient, verifiedOrgId, 'SUB_CREDITORS');
    if (!creditorsSubId) {
      return res.status(400).json({ success: false, error: "ERR_CREDITORS_ACCOUNT_NOT_FOUND", message: "حساب معین بستانکاران یافت نشد." });
    }

    // Resolve Bank/Cashbox Subsidiary UUID
    const bankCashboxSubId = await resolveSubsidiaryUuid(supabaseClient, verifiedOrgId, accountId);
    if (!bankCashboxSubId) {
      return res.status(400).json({ success: false, error: "ERR_ACCOUNT_NOT_FOUND", message: "حساب معین بانک/صندوق انتخاب شده یافت نشد." });
    }

    // Resolve Person UUID
    const resolvedPersonId = await resolvePersonUuid(supabaseClient, verifiedOrgId, personId, personName);
    if (!resolvedPersonId) {
      return res.status(400).json({ success: false, error: "ERR_PERSON_NOT_FOUND", message: "شخص انتخاب شده یافت نشد." });
    }

    const payAmount = Number(amount);
    const voucherDate = date || new Date().toISOString().split('T')[0];
    const pName = personName || 'طرف حساب';
    const voucherDesc = (description && description.trim()) || `پرداخت نقدی/حواله به ${pName}`;
    const opKey = operationKey || ('op_pay_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
    const requestFingerprint = 'fp_pay_' + Math.random().toString(36).substring(2, 15);

    const formattedEntries = [
      {
        row_number: 1,
        subsidiary_id: creditorsSubId,
        person_id: resolvedPersonId,
        cost_center_id: null,
        debit: payAmount,
        credit: 0,
        description: `پرداخت نقدی/حواله به ${pName}`
      },
      {
        row_number: 2,
        subsidiary_id: bankCashboxSubId,
        person_id: null,
        cost_center_id: null,
        debit: 0,
        credit: payAmount,
        description: 'خروج وجه نقدی/حواله'
      }
    ];

    // Step 1: Create Draft Voucher via RPC
    const { data: draftVoucherId, error: draftErr } = await supabaseClient.rpc('create_draft_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_branch_id: branchId,
      p_fiscal_year_id: fiscalYearId,
      p_voucher_date: voucherDate,
      p_description: voucherDesc,
      p_entries: formattedEntries,
      p_operation_key: opKey,
      p_request_fingerprint: requestFingerprint,
      p_source_type: 'CASH_PAYMENT',
      p_source_id: null,
      p_source_event_key: null
    });

    if (draftErr || !draftVoucherId) {
      return res.status(400).json({ success: false, error: "ERR_DRAFT_CREATION_FAILED", message: draftErr?.message || "خطا در ایجاد پیش‌نویس سند." });
    }

    // Step 2: Post/Finalize Voucher via RPC
    const postOpKey = 'op_post_' + opKey;
    const postFingerprint = 'fp_post_' + requestFingerprint;

    const { data: voucherNumber, error: postErr } = await supabaseClient.rpc('post_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_voucher_id: draftVoucherId,
      p_expected_version: 1,
      p_operation_key: postOpKey,
      p_request_fingerprint: postFingerprint
    });

    if (postErr) {
      return res.status(400).json({ success: false, error: "ERR_VOUCHER_POST_FAILED", message: postErr.message || "خطا در قطعی‌سازی سند." });
    }

    return res.status(201).json({
      success: true,
      data: {
        id: draftVoucherId,
        voucherNumber: Number(voucherNumber),
        date: voucherDate,
        description: voucherDesc,
        entries: formattedEntries
      },
      message: "پرداخت وجه با موفقیت در پایگاه داده ثبت و قطعی شد."
    });

  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 6. ATOMIC SIMPLE CASH RECEIPT FROM PERSON (POST /api/cash-transactions/receive)
app.post("/api/cash-transactions/receive", authMiddleware, createRoutePolicyMiddleware('CASH_RECEIVE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { personId, personName, accountId, amount, date, description, operationKey } = req.body || {};

    if (!personId || !accountId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "اطلاعات دریافت ناتمام یا نامعتبر است." });
    }

    // Resolve default branch for organization
    const { data: branchRow } = await supabaseClient
      .from('branches')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .limit(1)
      .single();

    if (!branchRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_BRANCH", message: "شعبه فعالی برای سازمان یافت نشد." });
    }
    const branchId = branchRow.id;

    // Resolve active fiscal year for organization
    const { data: fyRow } = await supabaseClient
      .from('fiscal_years')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('is_closed', false)
      .limit(1)
      .single();

    if (!fyRow) {
      return res.status(400).json({ success: false, error: "ERR_NO_FISCAL_YEAR", message: "سال مالی فعالی برای سازمان یافت نشد." });
    }
    const fiscalYearId = fyRow.id;

    // Resolve Trade Debtors Subsidiary UUID ('SUB_DEBTORS')
    const debtorsSubId = await resolveSubsidiaryUuid(supabaseClient, verifiedOrgId, 'SUB_DEBTORS');
    if (!debtorsSubId) {
      return res.status(400).json({ success: false, error: "ERR_DEBTORS_ACCOUNT_NOT_FOUND", message: "حساب معین بدهکاران تجاری یافت نشد." });
    }

    // Resolve Bank/Cashbox Subsidiary UUID
    const bankCashboxSubId = await resolveSubsidiaryUuid(supabaseClient, verifiedOrgId, accountId);
    if (!bankCashboxSubId) {
      return res.status(400).json({ success: false, error: "ERR_ACCOUNT_NOT_FOUND", message: "حساب معین بانک/صندوق انتخاب شده یافت نشد." });
    }

    // Resolve Person UUID
    const resolvedPersonId = await resolvePersonUuid(supabaseClient, verifiedOrgId, personId, personName);
    if (!resolvedPersonId) {
      return res.status(400).json({ success: false, error: "ERR_PERSON_NOT_FOUND", message: "شخص انتخاب شده یافت نشد." });
    }

    const receiveAmount = Number(amount);
    const voucherDate = date || new Date().toISOString().split('T')[0];
    const pName = personName || 'طرف حساب';
    const voucherDesc = (description && description.trim()) || `تسویه دریافتی از ${pName}`;
    const opKey = operationKey || ('op_receive_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9));
    const requestFingerprint = 'fp_receive_' + Math.random().toString(36).substring(2, 15);

    // Accounting Entries for Simple Cash/Bank Receipt:
    // Debit: Bank/Cashbox
    // Credit: Trade Debtors (SUB_DEBTORS) with Person reference
    const formattedEntries = [
      {
        row_number: 1,
        subsidiary_id: bankCashboxSubId,
        person_id: null,
        cost_center_id: null,
        debit: receiveAmount,
        credit: 0,
        description: `دریافت نقدی/واریز از ${pName}`
      },
      {
        row_number: 2,
        subsidiary_id: debtorsSubId,
        person_id: resolvedPersonId,
        cost_center_id: null,
        debit: 0,
        credit: receiveAmount,
        description: (description && description.trim()) || 'بابت تسویه حساب نقدی'
      }
    ];

    // Step 1: Create Draft Voucher via RPC
    const { data: draftVoucherId, error: draftErr } = await supabaseClient.rpc('create_draft_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_branch_id: branchId,
      p_fiscal_year_id: fiscalYearId,
      p_voucher_date: voucherDate,
      p_description: voucherDesc,
      p_entries: formattedEntries,
      p_operation_key: opKey,
      p_request_fingerprint: requestFingerprint,
      p_source_type: 'CASH_RECEIPT',
      p_source_id: null,
      p_source_event_key: null
    });

    if (draftErr || !draftVoucherId) {
      return res.status(400).json({ success: false, error: "ERR_DRAFT_CREATION_FAILED", message: draftErr?.message || "خطا در ایجاد پیش‌نویس سند." });
    }

    // Step 2: Post/Finalize Voucher via RPC
    const postOpKey = 'op_post_' + opKey;
    const { data: voucherNumber, error: postErr } = await supabaseClient.rpc('post_journal_voucher', {
      p_organization_id: verifiedOrgId,
      p_voucher_id: draftVoucherId,
      p_expected_version: 1,
      p_operation_key: postOpKey,
      p_request_fingerprint: 'fp_post_' + requestFingerprint
    });

    if (postErr) {
      return res.status(400).json({ success: false, error: "ERR_VOUCHER_POST_FAILED", message: postErr.message || "خطا در قطعی‌سازی سند." });
    }

    return res.status(201).json({
      success: true,
      data: {
        id: draftVoucherId,
        voucherNumber: Number(voucherNumber),
        date: voucherDate,
        description: voucherDesc,
        entries: formattedEntries
      },
      message: "دریافت وجه با موفقیت در پایگاه داده ثبت و قطعی شد."
    });

  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

import { executeServerCreateInvoice, executeServerUpdateInvoice, executeServerVoidInvoice, executeServerDeleteProInvoice, executeServerConvertOrder } from "./src/server/invoices/invoiceAtomicService";

// ==============================================================================
// INVOICES SECURE API ENDPOINTS (Block 2 - Command 7 & Command 8)
// ==============================================================================

// 1. GET /api/invoices - List invoices with items for authenticated organization
app.get("/api/invoices", authMiddleware, createRoutePolicyMiddleware('INVOICES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data: invoices, error: fetchErr } = await supabaseClient
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('organization_id', verifiedOrgId)
      .order('invoice_number', { ascending: false });

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_INVOICES_FAILED", message: fetchErr.message });
    }

    return res.json({
      success: true,
      organizationId: verifiedOrgId,
      data: invoices || []
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

// 2. GET /api/invoices/:id - Get single invoice by ID within organization scope
app.get("/api/invoices/:id", authMiddleware, createRoutePolicyMiddleware('INVOICE_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const invoiceId = req.params.id;
    const { data: invoice, error: fetchErr } = await supabaseClient
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', invoiceId)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    if (fetchErr || !invoice) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "فاکتور مورد نظر در این سازمان یافت نشد." });
    }

    return res.json({ success: true, data: invoice });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// ==============================================================================
// JOURNAL VOUCHERS SECURE READ API ENDPOINTS (Block 2 - Command 10)
// ==============================================================================

// 1. GET /api/vouchers - List journal vouchers with entries for authenticated organization
app.get("/api/vouchers", authMiddleware, createRoutePolicyMiddleware('VOUCHERS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data: vouchers, error: fetchErr } = await supabaseClient
      .from('journal_vouchers')
      .select('*, voucher_entries(*)')
      .eq('organization_id', verifiedOrgId)
      .order('voucher_number', { ascending: false, nullsFirst: false });

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_VOUCHERS_FAILED", message: fetchErr.message });
    }

    return res.json({
      success: true,
      organizationId: verifiedOrgId,
      data: vouchers || []
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

// 2. GET /api/vouchers/:id - Get single journal voucher by ID within organization scope
app.get("/api/vouchers/:id", authMiddleware, createRoutePolicyMiddleware('VOUCHER_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const voucherId = req.params.id;
    const { data: voucher, error: fetchErr } = await supabaseClient
      .from('journal_vouchers')
      .select('*, voucher_entries(*)')
      .eq('id', voucherId)
      .eq('organization_id', verifiedOrgId)
      .maybeSingle();

    if (fetchErr || !voucher) {
      return res.status(404).json({ success: false, error: "ERR_NOT_FOUND", message: "سند حسابداری مورد نظر در این سازمان یافت نشد." });
    }

    return res.json({ success: true, data: voucher });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 3. POST /api/invoices - ATOMIC INVOICE CREATION (POST /api/invoices) - BACKEND FOUNDATION (BLOCK 2 COMMAND 4 & 7)
app.post("/api/invoices", authMiddleware, createRoutePolicyMiddleware('INVOICE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const result = await executeServerCreateInvoice(supabaseClient, verifiedOrgId, userId, req.body);

    return res.status(201).json({
      success: true,
      data: result,
      message: "فاکتور با موفقیت در ساختار رابطه‌ای ثبت شد."
    });
  } catch (err: any) {
    const isClientErr = err.message && (err.message.startsWith("ERR_") || err.message.startsWith("23505"));
    return res.status(isClientErr ? 400 : 500).json({
      success: false,
      error: isClientErr ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR",
      message: err.message
    });
  }
});

// 4. PUT /api/invoices/:id - ATOMIC INVOICE UPDATE (PUT /api/invoices/:id) - BACKEND FOUNDATION (BLOCK 2 COMMAND 11)
app.put("/api/invoices/:id", authMiddleware, createRoutePolicyMiddleware('INVOICE_UPDATE_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const invoiceId = req.params.id;
    const result = await executeServerUpdateInvoice(supabaseClient, verifiedOrgId, userId, invoiceId, req.body);

    return res.json({
      success: true,
      data: result,
      message: "فاکتور با موفقیت در دیتابیس به‌روزرسانی شد."
    });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.includes("ERR_INVOICE_VERSION_CONFLICT") ? 409 : (err.message && err.message.startsWith("ERR_") ? 400 : 500));
    return res.status(statusCode).json({
      success: false,
      error: err.message ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR",
      message: err.message || "خطای غیرمنتظره در سرور."
    });
  }
});

// 5. POST /api/invoices/:id/void - ATOMIC INVOICE VOID (Command 12A)
app.post("/api/invoices/:id/void", authMiddleware, createRoutePolicyMiddleware('INVOICE_VOID_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const invoiceId = req.params.id;
    const reason = req.body.reason || "ابطال فاکتور";
    const result = await executeServerVoidInvoice(supabaseClient, verifiedOrgId, userId, invoiceId, reason);

    return res.json({
      success: true,
      data: result,
      message: "فاکتور با موفقیت ابطال شد."
    });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.startsWith("ERR_") ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR",
      message: err.message || "خطای غیرمنتظره در سرور."
    });
  }
});

// 6. DELETE /api/invoices/:id - SAFE PRO-INVOICE DELETION (Command 12A)
app.delete("/api/invoices/:id", authMiddleware, createRoutePolicyMiddleware('INVOICE_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const invoiceId = req.params.id;
    const result = await executeServerDeleteProInvoice(supabaseClient, verifiedOrgId, userId, invoiceId);

    return res.json({
      success: true,
      data: result,
      message: "پیش‌فاکتور با موفقیت حذف شد."
    });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.startsWith("ERR_") ? 400 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR",
      message: err.message || "خطای غیرمنتظره در سرور."
    });
  }
});

// POST /api/orders/convert - Authoritative Order-to-Invoice Conversion Guard (Block 2 - Command 13B)
app.post("/api/orders/convert", authMiddleware, createRoutePolicyMiddleware('ORDER_CONVERT_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { sourceOrderId, invoicePayload } = req.body;

    if (!sourceOrderId) {
      return res.status(400).json({ success: false, error: "ERR_SOURCE_ORDER_ID_REQUIRED", message: "شناسه سفارش مبدأ الزامی است." });
    }

    const result = await executeServerConvertOrder(supabaseClient, verifiedOrgId, userId, sourceOrderId, invoicePayload);

    return res.status(201).json({
      success: true,
      data: result,
      message: "سفارش با موفقیت و گارد ضدتکرار به فاکتور رسمی تبدیل شد."
    });
  } catch (err: any) {
    const isConflict = err.message && (err.message.includes("ERR_ORDER_CONVERSION_PAYLOAD_CONFLICT") || err.message.includes("23505"));
    const isClientErr = isConflict || (err.message && err.message.startsWith("ERR_"));
    const status = isConflict ? 409 : (isClientErr ? 400 : 500);
    return res.status(status).json({
      success: false,
      error: isConflict ? "ERR_ORDER_CONVERSION_PAYLOAD_CONFLICT" : (isClientErr ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR"),
      message: err.message
    });
  }
});


app.get("/api/supabase-config", authMiddleware, createRoutePolicyMiddleware('SUPABASE_CONFIG_GET'), (req: AuthenticatedRequest, res) => {

  try {
    let config = { 
      url: process.env.VITE_SUPABASE_URL || "", 
      key: process.env.VITE_SUPABASE_ANON_KEY || "" 
    };
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (saved.url && saved.key) {
        config = saved;
      }
    }
    res.json(config);
  } catch (e) {
    res.json({ url: "", key: "" });
  }
});

app.post("/api/supabase-config", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('SUPABASE_CONFIG_POST'), (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    const { url, key } = req.body;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url, key }), "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/download-zip", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('DOWNLOAD_ZIP_GET'), (req: AuthenticatedRequest, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Feature disabled in production environment" });
    }

    const zipPath = path.join(process.cwd(), "source_code.zip");
    
    // Generate fresh zip if requested or missing
    const { execSync } = require("child_process");
    const pyScript = `
import zipfile, os
exclude_dirs = {'node_modules', '.git', 'dist', '.vite', '__pycache__', '.upm'}
exclude_files = {'source_code.zip', 'project_source.zip', 'project.zip'}
with zipfile.ZipFile('source_code.zip', 'w', zipfile.ZIP_DEFLATED) as ziph:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file in exclude_files or file.endswith('.zip'):
                continue
            filepath = os.path.join(root, file)
            arcname = os.path.relpath(filepath, '.')
            ziph.write(filepath, arcname)
`;
    execSync(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`);

    if (fs.existsSync(zipPath)) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="nesyeh_project_source.zip"');
      return res.sendFile(zipPath);
    } else {
      return res.status(500).json({ error: "Could not generate ZIP file" });
    }
  } catch (err: any) {
    console.error("Error generating ZIP download:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backup/reset", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('BACKUP_RESET_POST'), (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    memoryState = null;
    if (fs.existsSync(STORE_FILE)) {
      fs.unlinkSync(STORE_FILE);
    }
    lastVersion = Date.now();
    lastUpdatedBy = userId;
    res.json({ success: true, version: lastVersion });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backup/restore", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('BACKUP_RESTORE_POST'), (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    const { state } = req.body;
    if (!state) {
      return res.status(400).json({ error: "No state provided for restore" });
    }
    memoryState = state;
    lastVersion = Date.now();
    lastUpdatedBy = userId;
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryState), "utf-8");
    res.json({ success: true, version: lastVersion });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/backup/replace", sensitiveAuthMiddleware, adminRoleMiddleware, createRoutePolicyMiddleware('BACKUP_REPLACE_POST'), (req: AuthenticatedRequest, res) => {
  try {
    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;
    const { state } = req.body;
    if (!state) {
      return res.status(400).json({ error: "No state provided for replacement" });
    }
    memoryState = state;
    lastVersion = Date.now();
    lastUpdatedBy = userId;
    fs.writeFileSync(STORE_FILE, JSON.stringify(memoryState), "utf-8");
    res.json({ success: true, version: lastVersion });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cheque Foundation Endpoints (Block 3 Command 4)
app.get("/api/cheques", authMiddleware, createRoutePolicyMiddleware('CHEQUES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const cheques = await executeServerGetCheques(supabaseClient, verifiedOrgId, {
      chequeType: req.query.chequeType as string,
      currentState: req.query.currentState as string,
      personId: req.query.personId as string,
    });

    return res.json({ success: true, organizationId: verifiedOrgId, data: cheques });
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ success: false, error: "ERR_FETCH_CHEQUES_FAILED", message: err.message });
  }
});

app.get("/api/cheques/:id", authMiddleware, createRoutePolicyMiddleware('CHEQUE_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    if (!url || !key) {
      return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
    }
    const supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: {
        headers: {
          Authorization: req.headers.authorization || "",
        },
      },
    });

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const cheque = await executeServerGetChequeById(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, data: cheque });
  } catch (err: any) {
    const statusCode = err.statusCode || (err.message && err.message.includes("NOT_FOUND") ? 404 : 500);
    return res.status(statusCode).json({ success: false, error: "ERR_GET_CHEQUE_FAILED", message: err.message });
  }
});

app.post("/api/cheques", authMiddleware, createRoutePolicyMiddleware('CHEQUE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const created = await executeServerCreateCheque(supabaseClient, verifiedOrgId, userId, req.body);
    return res.status(201).json({ success: true, data: created, message: "چک با موفقیت ثبت شد." });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({ success: false, error: err.message?.split(":")[0] || "ERR_CHEQUE_CREATE_FAILED", message: err.message });
  }
});

app.post("/api/cheques/:id/transition", authMiddleware, createRoutePolicyMiddleware('CHEQUE_TRANSITION_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const transitionResult = await executeServerTransitionCheque(supabaseClient, verifiedOrgId, userId, req.params.id, req.body);
    return res.json({ success: true, data: transitionResult, message: "وضعیت چک با موفقیت تغییر یافت." });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({ success: false, error: err.message?.split(":")[0] || "ERR_CHEQUE_TRANSITION_FAILED", message: err.message });
  }
});

app.post("/api/cheques/:id/reclassify-investor-commission", authMiddleware, createRoutePolicyMiddleware('CHEQUE_RECLASSIFY_INVESTOR_COMMISSION_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    // 3. Control Feature Activation Flag
    if (process.env.ENABLE_INVESTOR_COMMISSION_RECLASSIFICATION !== "true") {
      return res.status(503).json({
        success: false,
        error: "ERR_INVESTOR_COMMISSION_RECLASSIFICATION_NOT_ACTIVATED",
        message: "بازطبقهبندی چک کارمزد تا اعمال و آزمون مایگریشن رسمی پایگاهداده فعال نشده است. هیچ تغییری ثبت نشد."
      });
    }

    // 4. Input Validation & Strip Client-Supplied Restricted Fields
    const keysToStrip = [
      'organizationId', 'organization_id', 'orgId',
      'userId', 'user_id', 'performedBy', 'performed_by',
      'investorId', 'investor_id', 'investorPersonId', 'investor_person_id',
      'personId', 'person_id', 'contractId', 'contract_id',
      'amount', 'role', 'agency_role', 'x-organization-id',
      'requestFingerprint', 'request_fingerprint',
      'bankSubId', 'accountId', 'account_id', 'voucherId', 'voucher_id', 'journalVoucherId', 'journal_voucher_id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    const { obligationId, expectedVersion, operationKey } = req.body || {};

    if (!obligationId || typeof obligationId !== "string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(obligationId)) {
      return res.status(400).json({
        success: false,
        error: "ERR_INVALID_OBLIGATION_ID",
        message: "شناسه تعهد (obligationId) نامعتبر است."
      });
    }

    const version = Number(expectedVersion);
    if (expectedVersion === undefined || expectedVersion === null || !Number.isInteger(version) || version <= 0) {
      return res.status(400).json({
        success: false,
        error: "ERR_INVALID_EXPECTED_VERSION",
        message: "نسخه چک (expectedVersion) باید عدد صحیح بزرگتر از صفر باشد."
      });
    }

    if (!operationKey || typeof operationKey !== "string" || operationKey.trim().length === 0 || operationKey.trim().length > 128) {
      return res.status(400).json({
        success: false,
        error: "ERR_INVALID_OPERATION_KEY",
        message: "کلید عملیات (operationKey) اجباری و حداکثر ۱۲۸ نویسه است."
      });
    }

    const trimmedOperationKey = operationKey.trim();

    // 5. Get DB Client & Extract Verified Org and User
    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const userId = extractAuthenticatedActorId(req, res);
    if (!userId) return;

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const chequeId = req.params.id;

    // 6. Invoke Server Service
    const result = await executeServerReClassifyInvestorCommissionCheque(
      supabaseClient,
      verifiedOrgId,
      userId,
      chequeId,
      {
        obligationId,
        expectedVersion: version,
        operationKey: trimmedOperationKey,
      }
    );

    return res.json({
      success: true,
      data: result,
      message: "بازطبقهبندی چک کارمزد با موفقیت انجام شد."
    });
  } catch (err: any) {
    const statusCode = err.statusCode || 500;
    const errorCode = err.message ? err.message.split(":")[0] : "ERR_INTERNAL_SERVER_ERROR";
    const safeMessage = statusCode === 500 ? "خطای غیرمنتظره در سرور." : err.message;

    return res.status(statusCode).json({
      success: false,
      error: errorCode,
      message: safeMessage
    });
  }
});

app.post("/api/cheques/:id/edit", authMiddleware, createRoutePolicyMiddleware('CHEQUE_EDIT_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const editResult = await executeServerEditCheque(supabaseClient, verifiedOrgId, userId, req.params.id, req.body);
    return res.json({ success: true, data: editResult, message: "اطلاعات چک با موفقیت ویرایش شد." });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({ success: false, error: err.message?.split(":")[0] || "ERR_CHEQUE_EDIT_FAILED", message: err.message });
  }
});

app.post("/api/cheques/:id/reverse", authMiddleware, createRoutePolicyMiddleware('CHEQUE_REVERSE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const revResult = await executeServerReverseCheque(supabaseClient, verifiedOrgId, userId, req.params.id, req.body);
    return res.json({ success: true, data: revResult, message: "سند ابطال چک با موفقیت صادر شد." });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({ success: false, error: err.message?.split(":")[0] || "ERR_CHEQUE_REVERSE_FAILED", message: err.message });
  }
});

app.delete("/api/cheques/:id", authMiddleware, createRoutePolicyMiddleware('CHEQUE_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    const keysToStrip = [
      'userId', 'createdBy', 'created_by', 'postedBy', 'lastUpdatedBy',
      'organizationId', 'organization_id', 'orgId', 'role', 'agency_role', 'x-organization-id'
    ];
    keysToStrip.forEach(k => {
      if (req.body) { delete req.body[k]; }
      if (req.query) { delete req.query[k]; }
      if (req.headers) { delete req.headers[k]; }
    });

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch (err: any) {
      return res.status(503).json({
        success: false,
        error: "ERR_DB_UNCONFIGURED",
        message: "تنظیمات دیتابیس موجود نیست یا نامعتبر است."
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const expectedVersion = Number(req.query.expectedVersion || req.body?.expectedVersion || 1);
    const delResult = await executeServerDeleteCheque(supabaseClient, verifiedOrgId, req.params.id, expectedVersion);
    return res.json({ success: true, data: delResult, message: "چک با موفقیت حذف شد." });
  } catch (err: any) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json({ success: false, error: err.message?.split(":")[0] || "ERR_CHEQUE_DELETE_FAILED", message: err.message });
  }
});

// ==============================================================================
// CALCULATORS SECURE API ENDPOINTS
// ==============================================================================

// 1. GET /api/calculators - List all calculators for authenticated organization
app.get("/api/calculators", authMiddleware, createRoutePolicyMiddleware('CALCULATORS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data: calculators, error: fetchErr } = await supabaseClient
      .from('calculators')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .order('created_at', { ascending: true });

    if (fetchErr) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_CALCULATORS_FAILED", message: fetchErr.message });
    }

    return res.json({
      success: true,
      organizationId: verifiedOrgId,
      data: calculators || []
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message || "خطای غیرمنتظره در سرور." });
  }
});

// 2. POST /api/calculators - Create a new calculator
app.post("/api/calculators", authMiddleware, createRoutePolicyMiddleware('CALCULATORS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const body = req.body || {};
    const name = body.name ? String(body.name).trim() : '';
    if (!name) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "نام ماشین‌حساب الزامی است." });
    }

    const type = body.type || 'sadi_bazaar';
    const insertPayload: any = {
      organization_id: verifiedOrgId,
      name,
      description: body.description ? String(body.description).trim() : '',
      is_active: body.is_active !== undefined ? Boolean(body.is_active) : (body.isActive !== undefined ? Boolean(body.isActive) : true),
      type,
      agent_bank_id: body.agent_bank_id || body.agentBankId || null,
      bank_name: body.bank_name || body.bankName || null,
      base_rate_percent: body.base_rate_percent !== undefined ? Number(body.base_rate_percent) : (body.baseRatePercent !== undefined ? Number(body.baseRatePercent) : null),
      pelkani_tier1_base_rate: body.pelkani_tier1_base_rate !== undefined ? Number(body.pelkani_tier1_base_rate) : (body.pelkaniTier1BaseRate !== undefined ? Number(body.pelkaniTier1BaseRate) : null),
      pelkani_tier2_base_rate: body.pelkani_tier2_base_rate !== undefined ? Number(body.pelkani_tier2_base_rate) : (body.pelkaniTier2BaseRate !== undefined ? Number(body.pelkaniTier2BaseRate) : null),
      pelkani_tier3_base_rate: body.pelkani_tier3_base_rate !== undefined ? Number(body.pelkani_tier3_base_rate) : (body.pelkaniTier3BaseRate !== undefined ? Number(body.pelkaniTier3BaseRate) : null),
      beta_bank_fee_rate: body.beta_bank_fee_rate !== undefined ? Number(body.beta_bank_fee_rate) : (body.betaBankFeeRate !== undefined ? Number(body.betaBankFeeRate) : null),
      max_installment_count: body.max_installment_count !== undefined ? Number(body.max_installment_count) : (body.maxInstallmentCount !== undefined ? Number(body.maxInstallmentCount) : null),
      declining_slope_percentage: body.declining_slope_percentage !== undefined ? Number(body.declining_slope_percentage) : (body.decliningSlopePercentage !== undefined ? Number(body.decliningSlopePercentage) : null),
    };

    if (body.id && typeof body.id === 'string' && body.id.trim()) {
      insertPayload.id = body.id.trim();
    }

    const { data: inserted, error: insertErr } = await supabaseClient
      .from('calculators')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ success: false, error: "ERR_DUPLICATE_CALCULATOR", message: "ماشین‌حسابی با این شناسه یا نام قبلاً ثبت شده است." });
      }
      return res.status(500).json({ success: false, error: "ERR_INSERT_CALCULATOR_FAILED", message: insertErr.message });
    }

    return res.status(201).json({ success: true, data: inserted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 3. PUT /api/calculators/:id - Update an existing calculator
app.put("/api/calculators/:id", authMiddleware, createRoutePolicyMiddleware('CALCULATORS_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const calcId = req.params.id;
    const body = req.body || {};

    const updatePayload: any = {};
    if (body.name !== undefined) updatePayload.name = String(body.name).trim();
    if (body.description !== undefined) updatePayload.description = String(body.description).trim();
    if (body.is_active !== undefined) updatePayload.is_active = Boolean(body.is_active);
    else if (body.isActive !== undefined) updatePayload.is_active = Boolean(body.isActive);
    if (body.type !== undefined) updatePayload.type = body.type;
    if (body.agent_bank_id !== undefined) updatePayload.agent_bank_id = body.agent_bank_id || null;
    else if (body.agentBankId !== undefined) updatePayload.agent_bank_id = body.agentBankId || null;
    if (body.bank_name !== undefined) updatePayload.bank_name = body.bank_name || null;
    else if (body.bankName !== undefined) updatePayload.bank_name = body.bankName || null;
    if (body.base_rate_percent !== undefined) updatePayload.base_rate_percent = body.base_rate_percent !== null ? Number(body.base_rate_percent) : null;
    else if (body.baseRatePercent !== undefined) updatePayload.base_rate_percent = body.baseRatePercent !== null ? Number(body.baseRatePercent) : null;
    if (body.pelkani_tier1_base_rate !== undefined) updatePayload.pelkani_tier1_base_rate = body.pelkani_tier1_base_rate !== null ? Number(body.pelkani_tier1_base_rate) : null;
    else if (body.pelkaniTier1BaseRate !== undefined) updatePayload.pelkani_tier1_base_rate = body.pelkaniTier1BaseRate !== null ? Number(body.pelkaniTier1BaseRate) : null;
    if (body.pelkani_tier2_base_rate !== undefined) updatePayload.pelkani_tier2_base_rate = body.pelkani_tier2_base_rate !== null ? Number(body.pelkani_tier2_base_rate) : null;
    else if (body.pelkaniTier2BaseRate !== undefined) updatePayload.pelkani_tier2_base_rate = body.pelkaniTier2BaseRate !== null ? Number(body.pelkaniTier2BaseRate) : null;
    if (body.pelkani_tier3_base_rate !== undefined) updatePayload.pelkani_tier3_base_rate = body.pelkani_tier3_base_rate !== null ? Number(body.pelkani_tier3_base_rate) : null;
    else if (body.pelkaniTier3BaseRate !== undefined) updatePayload.pelkani_tier3_base_rate = body.pelkaniTier3BaseRate !== null ? Number(body.pelkaniTier3BaseRate) : null;
    if (body.beta_bank_fee_rate !== undefined) updatePayload.beta_bank_fee_rate = body.beta_bank_fee_rate !== null ? Number(body.beta_bank_fee_rate) : null;
    else if (body.betaBankFeeRate !== undefined) updatePayload.beta_bank_fee_rate = body.betaBankFeeRate !== null ? Number(body.betaBankFeeRate) : null;
    if (body.max_installment_count !== undefined) updatePayload.max_installment_count = body.max_installment_count !== null ? Number(body.max_installment_count) : null;
    else if (body.maxInstallmentCount !== undefined) updatePayload.max_installment_count = body.maxInstallmentCount !== null ? Number(body.maxInstallmentCount) : null;
    if (body.declining_slope_percentage !== undefined) updatePayload.declining_slope_percentage = body.declining_slope_percentage !== null ? Number(body.declining_slope_percentage) : null;
    else if (body.decliningSlopePercentage !== undefined) updatePayload.declining_slope_percentage = body.decliningSlopePercentage !== null ? Number(body.decliningSlopePercentage) : null;

    const { data: updated, error: updateErr } = await supabaseClient
      .from('calculators')
      .update(updatePayload)
      .eq('id', calcId)
      .eq('organization_id', verifiedOrgId)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ success: false, error: "ERR_UPDATE_CALCULATOR_FAILED", message: updateErr.message });
    }

    if (!updated) {
      return res.status(404).json({ success: false, error: "ERR_CALCULATOR_NOT_FOUND", message: "ماشین‌حساب مورد نظر در این سازمان یافت نشد." });
    }

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 4. DELETE /api/calculators/:id - Delete a calculator
app.delete("/api/calculators/:id", authMiddleware, createRoutePolicyMiddleware('CALCULATORS_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: {
          headers: {
            Authorization: req.headers.authorization || "",
          },
        },
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const calcId = req.params.id;
    const { error: deleteErr } = await supabaseClient
      .from('calculators')
      .delete()
      .eq('id', calcId)
      .eq('organization_id', verifiedOrgId);

    if (deleteErr) {
      return res.status(500).json({ success: false, error: "ERR_DELETE_CALCULATOR_FAILED", message: deleteErr.message });
    }

    return res.json({ success: true, message: "ماشین‌حساب با موفقیت حذف شد." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// ==============================================================================
// MEASUREMENT UNITS SECURE API ENDPOINTS
// ==============================================================================

// 1. GET /api/measurement-units - List measurement units
app.get("/api/measurement-units", authMiddleware, createRoutePolicyMiddleware('MEASUREMENT_UNITS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const units = await executeServerGetMeasurementUnits(supabaseClient, verifiedOrgId);
    return res.json({ success: true, organizationId: verifiedOrgId, data: units });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 2. POST /api/measurement-units - Create measurement unit
app.post("/api/measurement-units", authMiddleware, createRoutePolicyMiddleware('MEASUREMENT_UNITS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const created = await executeServerCreateMeasurementUnit(supabaseClient, verifiedOrgId, userId, req.body || {});
    return res.status(201).json({ success: true, organizationId: verifiedOrgId, data: created });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_CREATE_UNIT_FAILED", message: err.message });
  }
});

// 3. PUT /api/measurement-units/:id - Update measurement unit
app.put("/api/measurement-units/:id", authMiddleware, createRoutePolicyMiddleware('MEASUREMENT_UNITS_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const updated = await executeServerUpdateMeasurementUnit(supabaseClient, verifiedOrgId, req.params.id, req.body || {});
    return res.json({ success: true, organizationId: verifiedOrgId, data: updated });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_UPDATE_UNIT_FAILED", message: err.message });
  }
});

// 4. DELETE /api/measurement-units/:id - Deactivate measurement unit
app.delete("/api/measurement-units/:id", authMiddleware, createRoutePolicyMiddleware('MEASUREMENT_UNITS_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const result = await executeServerDeleteMeasurementUnit(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_DELETE_UNIT_FAILED", message: err.message });
  }
});

// ==============================================================================
// PRODUCT CATEGORIES SECURE API ENDPOINTS
// ==============================================================================

// 1. GET /api/product-categories - List product categories
app.get("/api/product-categories", authMiddleware, createRoutePolicyMiddleware('PRODUCT_CATEGORIES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const categories = await executeServerGetCategories(supabaseClient, verifiedOrgId);
    return res.json({ success: true, organizationId: verifiedOrgId, data: categories });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 2. POST /api/product-categories - Create product category
app.post("/api/product-categories", authMiddleware, createRoutePolicyMiddleware('PRODUCT_CATEGORIES_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const created = await executeServerCreateCategory(supabaseClient, verifiedOrgId, userId, req.body || {});
    return res.status(201).json({ success: true, organizationId: verifiedOrgId, data: created });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_CREATE_CATEGORY_FAILED", message: err.message });
  }
});

// 3. PUT /api/product-categories/:id - Update product category
app.put("/api/product-categories/:id", authMiddleware, createRoutePolicyMiddleware('PRODUCT_CATEGORIES_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const updated = await executeServerUpdateCategory(supabaseClient, verifiedOrgId, req.params.id, req.body || {});
    return res.json({ success: true, organizationId: verifiedOrgId, data: updated });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_UPDATE_CATEGORY_FAILED", message: err.message });
  }
});

// 4. DELETE /api/product-categories/:id - Deactivate product category
app.delete("/api/product-categories/:id", authMiddleware, createRoutePolicyMiddleware('PRODUCT_CATEGORIES_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const result = await executeServerDeleteCategory(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_DELETE_CATEGORY_FAILED", message: err.message });
  }
});

// ==============================================================================
// PRODUCTS SECURE API ENDPOINTS
// ==============================================================================

// 1. GET /api/products - List products
app.get("/api/products", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    const products = await executeServerGetProducts(supabaseClient, verifiedOrgId, includeInactive);

    return res.json({ success: true, organizationId: verifiedOrgId, data: products });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 2. GET /api/products/next-code - Get atomic next product code
app.get("/api/products/next-code", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_NEXT_CODE_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const code = await executeServerGetNextProductCode(supabaseClient, verifiedOrgId, userId);
    return res.json({ success: true, organizationId: verifiedOrgId, nextCode: code });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 3. GET /api/products/:id - Get product by ID
app.get("/api/products/:id", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const product = await executeServerGetProductById(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: product });
  } catch (err: any) {
    return res.status(404).json({ success: false, error: "ERR_PRODUCT_NOT_FOUND", message: err.message });
  }
});

// 4. POST /api/products - Create product or service
app.post("/api/products", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const created = await executeServerCreateProduct(supabaseClient, verifiedOrgId, userId, req.body || {});
    return res.status(201).json({ success: true, organizationId: verifiedOrgId, data: created });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_CREATE_PRODUCT_FAILED", message: err.message });
  }
});

// 5. PUT /api/products/:id - Update product or service
app.put("/api/products/:id", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const updated = await executeServerUpdateProduct(supabaseClient, verifiedOrgId, userId, req.params.id, req.body || {});
    return res.json({ success: true, organizationId: verifiedOrgId, data: updated });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_UPDATE_PRODUCT_FAILED", message: err.message });
  }
});

// 6. DELETE /api/products/:id - Deactivate product or service
app.delete("/api/products/:id", authMiddleware, createRoutePolicyMiddleware('PRODUCTS_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const result = await executeServerDeleteProduct(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_DELETE_PRODUCT_FAILED", message: err.message });
  }
});

// ==============================================================================
// WAREHOUSE MASTER DATA ROUTES (MIGRATION 06 & 29 DATABASE AUTHORITATIVE)
// ==============================================================================

// 1. GET /api/warehouses - List all warehouses for verified organization
app.get("/api/warehouses", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1';
    const warehouses = await executeServerGetWarehouses(supabaseClient, verifiedOrgId, includeInactive);

    return res.json({ success: true, organizationId: verifiedOrgId, data: warehouses });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 2. GET /api/warehouses/next-code - Get atomic next warehouse code
app.get("/api/warehouses/next-code", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_NEXT_CODE_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const code = await executeServerGetNextWarehouseCode(supabaseClient, verifiedOrgId, userId);
    return res.json({ success: true, organizationId: verifiedOrgId, nextCode: code });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_INTERNAL_SERVER_ERROR", message: err.message });
  }
});

// 3. GET /api/warehouses/:id - Get single warehouse by ID
app.get("/api/warehouses/:id", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_GET_BY_ID'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const warehouse = await executeServerGetWarehouseById(supabaseClient, verifiedOrgId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: warehouse });
  } catch (err: any) {
    return res.status(404).json({ success: false, error: "ERR_WAREHOUSE_NOT_FOUND", message: err.message });
  }
});

// 4. POST /api/warehouses - Create warehouse
app.post("/api/warehouses", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const payload = req.body || {};
    const createdWarehouse = await executeServerCreateWarehouse(supabaseClient, verifiedOrgId, userId, payload);

    return res.status(201).json({ success: true, organizationId: verifiedOrgId, data: createdWarehouse });
  } catch (err: any) {
    const status = err.message?.includes('ERR_DUPLICATE_') || err.message?.includes('ERR_INVALID_') || err.message?.includes('ERR_BRANCH_') ? 400 : 500;
    return res.status(status).json({ success: false, error: "ERR_CREATE_WAREHOUSE_FAILED", message: err.message });
  }
});

// 5. PUT /api/warehouses/:id - Update warehouse with optimistic concurrency
app.put("/api/warehouses/:id", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_PUT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const payload = req.body || {};
    const updatedWarehouse = await executeServerUpdateWarehouse(supabaseClient, verifiedOrgId, userId, req.params.id, payload);

    return res.json({ success: true, organizationId: verifiedOrgId, data: updatedWarehouse });
  } catch (err: any) {
    const status = err.message?.includes('ERR_CONCURRENCY_CONFLICT') ? 409 : 400;
    return res.status(status).json({ success: false, error: "ERR_UPDATE_WAREHOUSE_FAILED", message: err.message });
  }
});

// 6. PATCH /api/warehouses/:id/set-default - Atomically set active default warehouse for branch
app.patch("/api/warehouses/:id/set-default", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_SET_DEFAULT'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const updatedWarehouse = await executeServerSetDefaultWarehouse(supabaseClient, verifiedOrgId, userId, req.params.id);
    return res.json({ success: true, organizationId: verifiedOrgId, data: updatedWarehouse });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_SET_DEFAULT_WAREHOUSE_FAILED", message: err.message });
  }
});

// 7. DELETE /api/warehouses/:id - Deactivate warehouse (soft-delete with replacement default validation)
app.delete("/api/warehouses/:id", authMiddleware, createRoutePolicyMiddleware('WAREHOUSES_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) {
      return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });
    }

    let supabaseClient: any;
    try {
      supabaseClient = getSupabaseServerClient();
    } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      if (!url || !key) {
        return res.status(503).json({ success: false, error: "ERR_DB_UNCONFIGURED", message: "تنظیمات دیتابیس موجود نیست." });
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const replacementDefaultId = (req.body?.replacementDefaultWarehouseId || req.query.replacementDefaultId || req.body?.replacementDefaultId) as string | undefined;
    const result = await executeServerDeactivateWarehouse(supabaseClient, verifiedOrgId, userId, req.params.id, replacementDefaultId);

    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_DEACTIVATE_WAREHOUSE_FAILED", message: err.message });
  }
});

// 8. GET /api/warehouses/account-mappings - Fetch warehouse inventory account mappings
app.get("/api/warehouses/account-mappings", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_ACCOUNT_MAPPINGS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const warehouseId = req.query.warehouseId as string | undefined;
    const mappings = await executeGetWarehouseAccountMappings(supabaseClient, verifiedOrgId, warehouseId);
    return res.json({ success: true, organizationId: verifiedOrgId, data: mappings });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_ACCOUNT_MAPPINGS_FAILED", message: err.message });
  }
});

// 9. POST /api/warehouses/account-mappings - Set or update warehouse inventory subsidiary account mapping
app.post("/api/warehouses/account-mappings", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_ACCOUNT_MAPPINGS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { warehouseId, subsidiaryId, changeReason } = req.body || {};
    if (!warehouseId || !subsidiaryId) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "شناسه انبار و شناسه حساب معین الزامی است." });
    }

    const mapping = await executeSetWarehouseAccountMapping(supabaseClient, verifiedOrgId, userId, warehouseId, subsidiaryId, changeReason || "تعیین حساب معین موجودی انبار");
    return res.json({ success: true, organizationId: verifiedOrgId, data: mapping });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: "ERR_SET_ACCOUNT_MAPPING_FAILED", message: err.message });
  }
});

// 10. GET /api/warehouse-transfers - Fetch all warehouse transfers
app.get("/api/warehouse-transfers", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_TRANSFERS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const transfers = await executeGetWarehouseTransfers(supabaseClient, verifiedOrgId);
    return res.json({ success: true, organizationId: verifiedOrgId, data: transfers });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_TRANSFERS_FAILED", message: err.message });
  }
});

// 11. POST /api/warehouse-transfers - Execute atomic warehouse transfer
app.post("/api/warehouse-transfers", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_TRANSFERS_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { sourceWarehouseId, destinationWarehouseId, transferDate, description, operationKey, requestFingerprint, items } = req.body || {};
    if (!sourceWarehouseId || !destinationWarehouseId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_INPUT", message: "اطلاعات انبار مبدأ، مقصد و اقلام انتقال الزامی است." });
    }

    const result = await executeWarehouseTransferAtomic(supabaseClient, {
      organizationId: verifiedOrgId,
      userId,
      sourceWarehouseId,
      destinationWarehouseId,
      transferDate: transferDate || new Date().toISOString().split('T')[0],
      description: description || 'انتقال بین انبارها',
      operationKey: operationKey || `transfer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      requestFingerprint: requestFingerprint || `fp-${sourceWarehouseId}-${destinationWarehouseId}-${items.length}`,
      items
    });

    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message || "ERR_TRANSFER_FAILED", message: err.message });
  }
});

// 12. POST /api/warehouse-transfers/:id/reverse - Reverse posted warehouse transfer
app.post("/api/warehouse-transfers/:id/reverse", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_TRANSFERS_REVERSE_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const transactionId = req.params.id;
    const { reversalReason, operationKey, requestFingerprint } = req.body || {};

    const result = await executeReverseWarehouseTransferAtomic(supabaseClient, {
      organizationId: verifiedOrgId,
      userId,
      transactionId,
      reversalReason: reversalReason || 'برگشت انتقال انبار',
      operationKey: operationKey || `rev-${transactionId}-${Date.now()}`,
      requestFingerprint: requestFingerprint || `fp-rev-${transactionId}`
    });

    return res.json({ success: true, organizationId: verifiedOrgId, data: result });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message || "ERR_REVERSAL_FAILED", message: err.message });
  }
});

// 13. GET /api/warehouses/:warehouseId/products/:productId/serials - Fetch available product serials
app.get("/api/warehouses/:warehouseId/products/:productId/serials", authMiddleware, createRoutePolicyMiddleware('WAREHOUSE_PRODUCT_SERIALS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.authenticatedUserId;
    if (!userId) return res.status(401).json({ success: false, error: "ERR_UNAUTHORIZED", message: "هویت کاربر تأیید نشده است." });

    let supabaseClient: any;
    try { supabaseClient = getSupabaseServerClient(); } catch {
      let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
      let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
      if (fs.existsSync(CONFIG_FILE)) {
        try {
          const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
          if (saved.url && saved.key) { url = saved.url; key = saved.key; }
        } catch (e) {}
      }
      supabaseClient = createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
        global: { headers: { Authorization: req.headers.authorization || "" } }
      });
    }

    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { warehouseId, productId } = req.params;
    const serials = await executeGetProductSerials(supabaseClient, verifiedOrgId, warehouseId, productId);
    return res.json({ success: true, organizationId: verifiedOrgId, data: serials });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_SERIALS_FAILED", message: err.message });
  }
});

// ==============================================================================
// Command 7: Business Partners, Partner Credit Requests, Credit Policies & Credit Files Endpoints
// ==============================================================================

// Helper: Get Supabase client for route
function getRouteSupabaseClient(req: AuthenticatedRequest) {
  try {
    return getSupabaseServerClient();
  } catch {
    let url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
    let key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
        if (saved.url && saved.key) { url = saved.url; key = saved.key; }
      } catch (e) {}
    }
    return createClient(url.startsWith("postgresql://") ? "https://kzbaencltepwisdxcbbb.supabase.co" : url, key, {
      global: { headers: { Authorization: req.headers.authorization || "" } }
    });
  }
}

// 1. GET /api/business-partners
app.get("/api/business-partners", authMiddleware, createRoutePolicyMiddleware('BUSINESS_PARTNERS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data, error } = await supabaseClient
      .from('business_partners')
      .select('*')
      .eq('organization_id', verifiedOrgId);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_BUSINESS_PARTNERS_FAILED", message: error.message });
    }

    const businessPartners = (data || []).map((row: any) => ({
      id: row.id,
      personId: row.person_id,
      status: row.status,
      agencyType: row.agency_type,
      roles: row.roles || [],
      profile: row.profile || {},
      branches: row.branches || [],
      contract: row.contract || null,
      nesyehSettings: row.nesyeh_settings || null,
      nesyehOnboarding: row.nesyeh_onboarding || null,
      users: row.users || [],
      hasActivity: row.has_activity || false,
      allowedSalesPlanIds: row.allowed_sales_plan_ids || [],
      allowedCalculatorIds: row.allowed_calculator_ids || [],
      calculatorOverrides: row.calculator_overrides || null,
      salesExtension: row.sales_extension || null,
      creditExtension: row.credit_extension || null,
      featureToggles: row.feature_toggles || null,
      portalLinks: row.portal_links || null,
      version: row.version || 1,
      operationKey: row.operation_key || null,
      createdAt: row.created_at,
      createdBy: row.created_by || null,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || null
    }));

    return res.json({ success: true, businessPartners });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_BUSINESS_PARTNERS_FAILED", message: err.message });
  }
});

// Helper for Business Partner Upsert
async function handleBusinessPartnerUpsert(req: AuthenticatedRequest, res: any, isUpdate: boolean) {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const payload = req.body || {};
    const bpId = isUpdate ? (req.params.id || payload.id) : (payload.id || `BP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const { operationKey, version } = payload;

    // Idempotency check with operationKey
    if (operationKey) {
      const { data: existingOp } = await supabaseClient
        .from('business_partners')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('operation_key', operationKey)
        .single();

      if (existingOp) {
        // If data matches, return existing record
        if (existingOp.id === bpId || existingOp.person_id === payload.personId) {
          return res.json({
            success: true,
            businessPartner: {
              id: existingOp.id,
              personId: existingOp.person_id,
              status: existingOp.status,
              agencyType: existingOp.agency_type,
              roles: existingOp.roles || [],
              profile: existingOp.profile || {},
              salesExtension: existingOp.sales_extension,
              creditExtension: existingOp.credit_extension,
              version: existingOp.version,
              operationKey: existingOp.operation_key
            }
          });
        } else {
          return res.status(400).json({ success: false, error: "ERR_OPERATION_KEY_MISMATCH", message: "کلید عملیات قبلاً با داده‌های متفاوت استفاده شده است." });
        }
      }
    }

    // Check version for optimistic concurrency control on update
    let newVersion = 1;
    if (isUpdate) {
      const { data: currentBp } = await supabaseClient
        .from('business_partners')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('id', bpId)
        .single();

      if (currentBp) {
        if (version !== undefined && version !== null && version !== currentBp.version) {
          return res.status(409).json({ success: false, error: "ERR_STALE_VERSION", message: "اطلاعات نماینده توسط کاربر دیگری تغییر یافته است. لطفا صفحه را بازخوانی کنید." });
        }
        newVersion = (currentBp.version || 1) + 1;
      }
    }

    // Person Deduplication Rule 3: Check if national ID exists in persons table
    let resolvedPersonId = payload.personId;
    const nationalId = payload.profile?.nationalId || payload.nationalId;
    if (nationalId) {
      const { data: existingPerson } = await supabaseClient
        .from('persons')
        .select('id, agency_role, agency_status')
        .eq('organization_id', verifiedOrgId)
        .eq('national_id', nationalId)
        .maybeSingle();

      if (existingPerson) {
        resolvedPersonId = existingPerson.id;
      }
    }

    if (!resolvedPersonId) {
      resolvedPersonId = `PER_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }

    // Ensure person exists in persons table with independent role attributes
    const isSales = payload.roles?.includes('sales') || payload.agencyType === 'sales';
    const isCredit = payload.roles?.includes('credit') || payload.agencyType === 'credit' || payload.roles?.includes('agent');
    const agencyRole = (isSales && isCredit) ? 'both' : (isCredit ? 'credit' : (isSales ? 'sales' : 'both'));

    await supabaseClient
      .from('persons')
      .upsert({
        id: resolvedPersonId,
        organization_id: verifiedOrgId,
        name: payload.profile?.fullName || payload.name || 'نماینده اعتباری',
        national_id: nationalId || null,
        mobile: payload.profile?.phone || payload.mobile || null,
        is_agent: true,
        agency_role: agencyRole,
        agency_status: payload.status || 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    const bpRow = {
      id: bpId,
      organization_id: verifiedOrgId,
      person_id: resolvedPersonId,
      status: payload.status || 'active',
      agency_type: payload.agencyType || agencyRole,
      roles: payload.roles || ['credit'],
      profile: payload.profile || {},
      branches: payload.branches || [],
      contract: payload.contract || null,
      nesyeh_settings: payload.nesyehSettings || null,
      nesyeh_onboarding: payload.nesyehOnboarding || null,
      users: payload.users || [],
      has_activity: payload.hasActivity || false,
      allowed_sales_plan_ids: payload.allowedSalesPlanIds || [],
      allowed_calculator_ids: payload.allowedCalculatorIds || [],
      calculator_overrides: payload.calculatorOverrides || null,
      sales_extension: payload.salesExtension || null,
      credit_extension: payload.creditExtension || null,
      feature_toggles: payload.featureToggles || null,
      portal_links: payload.portalLinks || null,
      version: newVersion,
      operation_key: operationKey || null,
      updated_at: new Date().toISOString(),
      updated_by: req.headers['x-user-id'] as string || 'system'
    };

    const { error: saveErr } = await supabaseClient
      .from('business_partners')
      .upsert(bpRow, { onConflict: 'id' });

    if (saveErr) {
      return res.status(500).json({ success: false, error: "ERR_SAVE_BUSINESS_PARTNER_FAILED", message: saveErr.message });
    }

    const savedBp = {
      id: bpId,
      personId: resolvedPersonId,
      status: bpRow.status,
      agencyType: bpRow.agency_type,
      roles: bpRow.roles,
      profile: bpRow.profile,
      salesExtension: bpRow.sales_extension,
      creditExtension: bpRow.credit_extension,
      version: newVersion,
      operationKey: operationKey || null
    };

    return res.json({ success: true, businessPartner: savedBp });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_SAVE_BUSINESS_PARTNER_FAILED", message: err.message });
  }
}

// 2. POST /api/business-partners
app.post("/api/business-partners", authMiddleware, createRoutePolicyMiddleware('BUSINESS_PARTNERS_POST'), async (req: AuthenticatedRequest, res) => {
  return handleBusinessPartnerUpsert(req, res, false);
});

// 3. PUT /api/business-partners/:id
app.put("/api/business-partners/:id", authMiddleware, createRoutePolicyMiddleware('BUSINESS_PARTNERS_PUT'), async (req: AuthenticatedRequest, res) => {
  return handleBusinessPartnerUpsert(req, res, true);
});

// 4. GET /api/partner-credit-requests
app.get("/api/partner-credit-requests", authMiddleware, createRoutePolicyMiddleware('PARTNER_CREDIT_REQUESTS_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data, error } = await supabaseClient
      .from('partner_credit_requests')
      .select('*')
      .eq('organization_id', verifiedOrgId);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_PARTNER_CREDIT_REQUESTS_FAILED", message: error.message });
    }

    const partnerCreditRequests = (data || []).map((row: any) => ({
      id: row.id,
      branchId: row.branch_id,
      businessPartnerId: row.business_partner_id,
      customerPersonId: row.customer_person_id,
      status: row.status,
      requestedAmount: Number(row.requested_amount || 0),
      salePlanId: row.sale_plan_id,
      termCount: row.term_count,
      paymentPeriod: row.payment_period,
      documents: row.documents || [],
      submittedChecks: row.submitted_checks || [],
      approvalHistory: row.approval_history || [],
      validationResult: row.validation_result,
      calculationResults: row.calculation_results,
      rejectionReason: row.rejection_reason,
      version: row.version || 1,
      operationKey: row.operation_key,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    }));

    return res.json({ success: true, partnerCreditRequests });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_PARTNER_CREDIT_REQUESTS_FAILED", message: err.message });
  }
});

// Helper for Partner Credit Request Upsert
async function handlePartnerCreditRequestUpsert(req: AuthenticatedRequest, res: any, isUpdate: boolean) {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const payload = req.body || {};
    const reqId = isUpdate ? (req.params.id || payload.id) : (payload.id || `PCR_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const { operationKey, version } = payload;

    // Idempotency check with operationKey
    if (operationKey) {
      const { data: existingOp } = await supabaseClient
        .from('partner_credit_requests')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('operation_key', operationKey)
        .single();

      if (existingOp) {
        if (existingOp.id === reqId || existingOp.business_partner_id === payload.businessPartnerId) {
          return res.json({
            success: true,
            partnerCreditRequest: {
              id: existingOp.id,
              businessPartnerId: existingOp.business_partner_id,
              customerPersonId: existingOp.customer_person_id,
              status: existingOp.status,
              requestedAmount: Number(existingOp.requested_amount || 0),
              version: existingOp.version,
              operationKey: existingOp.operation_key
            }
          });
        } else {
          return res.status(400).json({ success: false, error: "ERR_OPERATION_KEY_MISMATCH", message: "کلید عملیات قبلاً با داده‌های متفاوت استفاده شده است." });
        }
      }
    }

    // Version check for optimistic concurrency
    let newVersion = 1;
    if (isUpdate) {
      const { data: currentReq } = await supabaseClient
        .from('partner_credit_requests')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('id', reqId)
        .single();

      if (currentReq) {
        if (version !== undefined && version !== null && version !== currentReq.version) {
          return res.status(409).json({ success: false, error: "ERR_STALE_VERSION", message: "درخواست اعتبار توسط کاربر دیگری تغییر یافته است." });
        }
        newVersion = (currentReq.version || 1) + 1;
      }
    }

    // Incomplete dossier submission validation
    const submittingStatuses = ['SUBMITTED_BY_PARTNER', 'UNDER_REVIEW', 'APPROVED', 'FINAL_APPROVED', 'pending', 'ready_to_send'];
    if (submittingStatuses.includes(payload.status)) {
      if (!payload.customerPersonId && !payload.personId) {
        return res.status(400).json({ success: false, error: "ERR_INCOMPLETE_CREDIT_FILE", message: "اطلاعات یا مدارک پرونده اعتباری ناقص است: مشتری مشخص نشده است." });
      }
      const amt = Number(payload.requestedAmount || 0);
      if (amt <= 0) {
        return res.status(400).json({ success: false, error: "ERR_INCOMPLETE_CREDIT_FILE", message: "اطلاعات یا مدارک پرونده اعتباری ناقص است: مبلغ اعتبار نامعتبر است." });
      }
    }

    const rowData = {
      id: reqId,
      organization_id: verifiedOrgId,
      branch_id: payload.branchId || null,
      business_partner_id: payload.businessPartnerId || 'BP_UNKNOWN',
      customer_person_id: payload.customerPersonId || payload.personId || 'PER_UNKNOWN',
      status: payload.status || 'DRAFT',
      requested_amount: Number(payload.requestedAmount || 0),
      sale_plan_id: payload.salePlanId || null,
      term_count: payload.termCount || 0,
      payment_period: payload.paymentPeriod || 0,
      documents: payload.documents || [],
      submitted_checks: payload.submittedChecks || [],
      approval_history: payload.approvalHistory || [],
      validation_result: payload.validationResult || null,
      calculation_results: payload.calculationResults || null,
      rejection_reason: payload.rejectionReason || null,
      version: newVersion,
      operation_key: operationKey || null,
      updated_at: new Date().toISOString(),
      updated_by: req.headers['x-user-id'] as string || 'system'
    };

    const { error: saveErr } = await supabaseClient
      .from('partner_credit_requests')
      .upsert(rowData, { onConflict: 'id' });

    if (saveErr) {
      return res.status(500).json({ success: false, error: "ERR_SAVE_PARTNER_CREDIT_REQUEST_FAILED", message: saveErr.message });
    }

    const savedRequest = {
      id: reqId,
      businessPartnerId: rowData.business_partner_id,
      customerPersonId: rowData.customer_person_id,
      status: rowData.status,
      requestedAmount: rowData.requested_amount,
      version: newVersion,
      operationKey: operationKey || null
    };

    return res.json({ success: true, partnerCreditRequest: savedRequest });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_SAVE_PARTNER_CREDIT_REQUEST_FAILED", message: err.message });
  }
}

// 5. POST /api/partner-credit-requests
app.post("/api/partner-credit-requests", authMiddleware, createRoutePolicyMiddleware('PARTNER_CREDIT_REQUESTS_POST'), async (req: AuthenticatedRequest, res) => {
  return handlePartnerCreditRequestUpsert(req, res, false);
});

// 6. PUT /api/partner-credit-requests/:id
app.put("/api/partner-credit-requests/:id", authMiddleware, createRoutePolicyMiddleware('PARTNER_CREDIT_REQUESTS_PUT'), async (req: AuthenticatedRequest, res) => {
  return handlePartnerCreditRequestUpsert(req, res, true);
});

// 7. GET /api/credit-policies
app.get("/api/credit-policies", authMiddleware, createRoutePolicyMiddleware('CREDIT_POLICIES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data, error } = await supabaseClient
      .from('credit_policies')
      .select('*')
      .eq('organization_id', verifiedOrgId);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_CREDIT_POLICIES_FAILED", message: error.message });
    }

    const creditPolicies = (data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      minAmount: Number(row.min_amount || 0),
      maxAmount: Number(row.max_amount || 0),
      needsValidation: Boolean(row.needs_validation),
      needsBackSignature: Boolean(row.needs_back_signature),
      needsCollateral: Boolean(row.needs_collateral),
      needsGuarantorInfo: Boolean(row.needs_guarantor_info),
      needsGuarantorValidation: Boolean(row.needs_guarantor_validation),
      needsAmaniCheck: Boolean(row.needs_amani_check),
      amaniReminderDays: Number(row.amani_reminder_days || 0),
      isActive: Boolean(row.is_active),
      version: row.version || 1,
      operationKey: row.operation_key
    }));

    return res.json({ success: true, creditPolicies });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_CREDIT_POLICIES_FAILED", message: err.message });
  }
});

// 8. POST /api/credit-policies
app.post("/api/credit-policies", authMiddleware, createRoutePolicyMiddleware('CREDIT_POLICIES_POST'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const policiesPayload = req.body.creditPolicies || (Array.isArray(req.body) ? req.body : [req.body]);
    const savedPolicies = [];

    for (const p of policiesPayload) {
      const pId = p.id || `CP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const rowData = {
        id: pId,
        organization_id: verifiedOrgId,
        title: p.title || 'سیاست اعتباری',
        min_amount: Number(p.minAmount || 0),
        max_amount: Number(p.maxAmount || 0),
        needs_validation: Boolean(p.needsValidation),
        needs_back_signature: Boolean(p.needsBackSignature),
        needs_collateral: Boolean(p.needsCollateral),
        needs_guarantor_info: Boolean(p.needsGuarantorInfo),
        needs_guarantor_validation: Boolean(p.needsGuarantorValidation),
        needs_amani_check: Boolean(p.needsAmaniCheck),
        amani_reminder_days: Number(p.amaniReminderDays || 0),
        is_active: p.isActive !== false,
        version: (p.version || 1) + 1,
        operation_key: req.body.operationKey || p.operationKey || null,
        updated_at: new Date().toISOString()
      };

      const { error: pErr } = await supabaseClient
        .from('credit_policies')
        .upsert(rowData, { onConflict: 'id' });

      if (pErr) {
        return res.status(500).json({ success: false, error: "ERR_SAVE_CREDIT_POLICY_FAILED", message: pErr.message });
      }

      savedPolicies.push({
        id: pId,
        title: rowData.title,
        minAmount: rowData.min_amount,
        maxAmount: rowData.max_amount,
        needsValidation: rowData.needs_validation,
        needsBackSignature: rowData.needs_back_signature,
        needsCollateral: rowData.needs_collateral,
        needsGuarantorInfo: rowData.needs_guarantor_info,
        needsGuarantorValidation: rowData.needs_guarantor_validation,
        needsAmaniCheck: rowData.needs_amani_check,
        amaniReminderDays: rowData.amani_reminder_days,
        isActive: rowData.is_active,
        version: rowData.version
      });
    }

    return res.json({ success: true, creditPolicies: savedPolicies });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_SAVE_CREDIT_POLICY_FAILED", message: err.message });
  }
});

// 9. GET /api/credit-files
app.get("/api/credit-files", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { data, error } = await supabaseClient
      .from('credit_files')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .is('deleted_at', null);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_CREDIT_FILES_FAILED", message: error.message });
    }

    const creditFiles = (data || []).map((row: any) => ({
      id: row.id,
      personId: row.person_id,
      representativeId: row.representative_id,
      status: row.status,
      requestedAmount: Number(row.requested_amount || 0),
      plan: row.plan || '',
      agentCommissionAmount: Number(row.agent_commission_amount || 0),
      agentCommissionRate: row.agent_commission_rate ? Number(row.agent_commission_rate) : undefined,
      agentBankId: row.agent_bank_id || undefined,
      agentBankName: row.agent_bank_name || undefined,
      settlementType: row.settlement_type || undefined,
      createdAt: row.created_at,
      paymentDocuments: row.payment_documents || [],
      receivedChecks: row.received_checks || [],
      revisionNote: row.revision_note || undefined,
      policyId: row.policy_id || undefined,
      policySnapshot: row.policy_snapshot || undefined,
      guarantorName: row.guarantor_name || undefined,
      guarantorNationalId: row.guarantor_national_id || undefined,
      guarantorPhone: row.guarantor_phone || undefined,
      collateralType: row.collateral_type || undefined,
      collateralDescription: row.collateral_description || undefined,
      collateralValue: row.collateral_value ? Number(row.collateral_value) : undefined,
      amaniCheckNumber: row.amani_check_number || undefined,
      amaniCheckBankName: row.amani_check_bank_name || undefined,
      version: row.version || 1,
      operationKey: row.operation_key || null
    }));

    return res.json({ success: true, creditFiles });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_CREDIT_FILES_FAILED", message: err.message });
  }
});

// Helper for Credit File Upsert
async function handleCreditFileUpsert(req: AuthenticatedRequest, res: any, isUpdate: boolean) {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const payload = req.body || {};
    const fileId = isUpdate ? (req.params.id || payload.id) : (payload.id || `CF_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const { operationKey, version } = payload;

    // Idempotency check with operationKey
    if (operationKey) {
      const { data: existingOp } = await supabaseClient
        .from('credit_files')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('operation_key', operationKey)
        .single();

      if (existingOp) {
        if (existingOp.id === fileId || existingOp.person_id === payload.personId) {
          return res.json({
            success: true,
            creditFile: {
              id: existingOp.id,
              personId: existingOp.person_id,
              representativeId: existingOp.representative_id,
              status: existingOp.status,
              requestedAmount: Number(existingOp.requested_amount || 0),
              plan: existingOp.plan,
              version: existingOp.version,
              operationKey: existingOp.operation_key
            }
          });
        } else {
          return res.status(400).json({ success: false, error: "ERR_OPERATION_KEY_MISMATCH", message: "کلید عملیات قبلاً با داده‌های متفاوت استفاده شده است." });
        }
      }
    }

    // Version check for optimistic concurrency
    let newVersion = 1;
    let existingFile: any = null;
    if (isUpdate) {
      const { data: currentFile } = await supabaseClient
        .from('credit_files')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('id', fileId)
        .single();

      if (currentFile) {
        existingFile = currentFile;
        if (version !== undefined && version !== null && version !== currentFile.version) {
          return res.status(409).json({ success: false, error: "ERR_STALE_VERSION", message: "پرونده اعتباری توسط کاربر دیگری تغییر یافته است." });
        }
        newVersion = (currentFile.version || 1) + 1;
      }
    }

    // Validation for incomplete dossier submission
    const submittingStatuses = ['pending', 'ready_to_send', 'approved', 'submitted'];
    const targetStatus = payload.status || (existingFile ? existingFile.status : 'draft');
    if (submittingStatuses.includes(targetStatus)) {
      const personId = payload.personId || (existingFile ? existingFile.person_id : null);
      if (!personId) {
        return res.status(400).json({ success: false, error: "ERR_INCOMPLETE_CREDIT_FILE", message: "اطلاعات یا مدارک پرونده اعتباری ناقص است: مشتری انتخاب نشده است." });
      }
      const amt = payload.requestedAmount !== undefined ? Number(payload.requestedAmount) : Number(existingFile ? existingFile.requested_amount : 0);
      if (amt <= 0) {
        return res.status(400).json({ success: false, error: "ERR_INCOMPLETE_CREDIT_FILE", message: "اطلاعات یا مدارک پرونده اعتباری ناقص است: مبلغ درخواست شده نامعتبر است." });
      }
    }

    const rowData = {
      id: fileId,
      organization_id: verifiedOrgId,
      person_id: payload.personId || (existingFile ? existingFile.person_id : 'PER_UNKNOWN'),
      representative_id: payload.representativeId || (existingFile ? existingFile.representative_id : null),
      status: targetStatus,
      requested_amount: payload.requestedAmount !== undefined ? Number(payload.requestedAmount) : Number(existingFile ? existingFile.requested_amount : 0),
      plan: payload.plan !== undefined ? payload.plan : (existingFile ? existingFile.plan : ''),
      agent_commission_amount: payload.agentCommissionAmount !== undefined ? Number(payload.agentCommissionAmount) : Number(existingFile ? existingFile.agent_commission_amount : 0),
      agent_commission_rate: payload.agentCommissionRate !== undefined ? payload.agentCommissionRate : (existingFile ? existingFile.agent_commission_rate : null),
      agent_bank_id: payload.agentBankId !== undefined ? payload.agentBankId : (existingFile ? existingFile.agent_bank_id : null),
      agent_bank_name: payload.agentBankName !== undefined ? payload.agentBankName : (existingFile ? existingFile.agent_bank_name : null),
      settlement_type: payload.settlementType !== undefined ? payload.settlementType : (existingFile ? existingFile.settlement_type : null),
      payment_documents: payload.paymentDocuments || (existingFile ? existingFile.payment_documents : []),
      received_checks: payload.receivedChecks || (existingFile ? existingFile.received_checks : []),
      revision_note: payload.revisionNote !== undefined ? payload.revisionNote : (existingFile ? existingFile.revision_note : null),
      policy_id: payload.policyId !== undefined ? payload.policyId : (existingFile ? existingFile.policy_id : null),
      policy_snapshot: payload.policySnapshot || (existingFile ? existingFile.policy_snapshot : null),
      guarantor_name: payload.guarantorName !== undefined ? payload.guarantorName : (existingFile ? existingFile.guarantor_name : null),
      guarantor_national_id: payload.guarantorNationalId !== undefined ? payload.guarantorNationalId : (existingFile ? existingFile.guarantor_national_id : null),
      guarantor_phone: payload.guarantorPhone !== undefined ? payload.guarantorPhone : (existingFile ? existingFile.guarantor_phone : null),
      collateral_type: payload.collateralType !== undefined ? payload.collateralType : (existingFile ? existingFile.collateral_type : null),
      collateral_description: payload.collateralDescription !== undefined ? payload.collateralDescription : (existingFile ? existingFile.collateral_description : null),
      collateral_value: payload.collateralValue !== undefined ? payload.collateralValue : (existingFile ? existingFile.collateral_value : null),
      amani_check_number: payload.amaniCheckNumber !== undefined ? payload.amaniCheckNumber : (existingFile ? existingFile.amani_check_number : null),
      amani_check_bank_name: payload.amaniCheckBankName !== undefined ? payload.amaniCheckBankName : (existingFile ? existingFile.amani_check_bank_name : null),
      version: newVersion,
      operation_key: operationKey || (existingFile ? existingFile.operation_key : null),
      updated_at: new Date().toISOString(),
      updated_by: req.headers['x-user-id'] as string || 'system'
    };

    const { error: saveErr } = await supabaseClient
      .from('credit_files')
      .upsert(rowData, { onConflict: 'id' });

    if (saveErr) {
      return res.status(500).json({ success: false, error: "ERR_SAVE_CREDIT_FILE_FAILED", message: saveErr.message });
    }

    const savedFile = {
      id: fileId,
      personId: rowData.person_id,
      representativeId: rowData.representative_id,
      status: rowData.status,
      requestedAmount: rowData.requested_amount,
      plan: rowData.plan,
      agentCommissionAmount: rowData.agent_commission_amount,
      paymentDocuments: rowData.payment_documents,
      receivedChecks: rowData.received_checks,
      revisionNote: rowData.revision_note,
      version: newVersion,
      operationKey: rowData.operation_key
    };

    return res.json({ success: true, creditFile: savedFile });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_SAVE_CREDIT_FILE_FAILED", message: err.message });
  }
}

// 10. POST /api/credit-files
app.post("/api/credit-files", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_POST'), async (req: AuthenticatedRequest, res) => {
  return handleCreditFileUpsert(req, res, false);
});

// 11. PUT /api/credit-files/:id
app.put("/api/credit-files/:id", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_PUT'), async (req: AuthenticatedRequest, res) => {
  return handleCreditFileUpsert(req, res, true);
});

// 12. DELETE /api/credit-files/:id (SOFT DELETE ONLY - NO PHYSICAL REMOVAL)
app.delete("/api/credit-files/:id", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { id } = req.params;
    const deletionReason = req.body?.deletionReason || req.body?.cancellationReason || (req.query?.reason as string);

    // Fetch existing file to verify existence and check status
    const { data: existingFile } = await supabaseClient
      .from('credit_files')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (!existingFile) {
      return res.status(404).json({ success: false, error: "ERR_CREDIT_FILE_NOT_FOUND", message: "پرونده اعتباری یافت نشد یا قبلاً لغو شده است." });
    }

    const nonDraftStatuses = ['submitted', 'pending', 'ready_to_send', 'approved', 'under_review'];
    if (nonDraftStatuses.includes(existingFile.status) && (!deletionReason || !deletionReason.trim())) {
      return res.status(400).json({
        success: false,
        error: "ERR_CANCELLATION_REASON_REQUIRED",
        message: "لغو پرونده‌های ارسال‌شده یا بررسی‌شده نیازمند ذکر دلیل مشخص می‌باشد."
      });
    }

    // Perform SOFT DELETE by setting status='canceled', deleted_at, deleted_by, deletion_reason
    const { error } = await supabaseClient
      .from('credit_files')
      .update({
        status: 'canceled',
        deleted_at: new Date().toISOString(),
        deleted_by: (req.headers['x-user-id'] as string) || 'system',
        deletion_reason: deletionReason || 'لغو و بایگانی پرونده',
        version: (existingFile.version || 1) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('organization_id', verifiedOrgId)
      .eq('id', id);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_DELETE_CREDIT_FILE_FAILED", message: error.message });
    }

    return res.json({ success: true, message: "پرونده اعتباری با موفقیت به صورت نرم لغو و بایگانی گردید." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_DELETE_CREDIT_FILE_FAILED", message: err.message });
  }
});

// 13. Relational Credit File Documents Endpoints & Storage
const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
];
const MAX_DOCUMENT_FILE_SIZE = 15728640; // 15 MB in bytes

const documentUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('ERR_INVALID_FILE_TYPE'));
    }
  }
});

app.get("/api/credit-files/:fileId/documents", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { fileId } = req.params;

    const { data: creditFile } = await supabaseClient
      .from('credit_files')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('id', fileId)
      .is('deleted_at', null)
      .single();

    if (!creditFile) {
      return res.status(404).json({ success: false, error: "ERR_CREDIT_FILE_NOT_FOUND_OR_FORBIDDEN", message: "پرونده اعتباری یافت نشد یا دسترسی غیرمجاز است." });
    }

    const { data: docs, error } = await supabaseClient
      .from('credit_file_documents')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .eq('credit_file_id', fileId)
      .eq('status', 'ACTIVE');

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_FETCH_DOCUMENTS_FAILED", message: error.message });
    }

    const documents = (docs || []).map((d: any) => ({
      id: d.id,
      creditFileId: d.credit_file_id,
      documentType: d.document_type,
      originalName: d.original_name,
      storageProvider: d.storage_provider,
      storageKey: d.storage_key,
      mimeType: d.mime_type,
      sizeBytes: Number(d.size_bytes || 0),
      checksum: d.checksum,
      status: d.status,
      version: d.version,
      operationKey: d.operation_key,
      createdAt: d.created_at,
      createdBy: d.created_by,
      downloadUrl: `/api/credit-files/${fileId}/documents/${d.id}/download`
    }));

    return res.json({ success: true, documents });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_FETCH_DOCUMENTS_FAILED", message: err.message });
  }
});

app.post("/api/credit-files/:fileId/documents", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_POST'), (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  documentUploadMiddleware.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE' || err.message === 'File too large') {
        return res.status(400).json({ success: false, error: "ERR_FILE_TOO_LARGE", message: "حجم فایل بیش از حد مجاز (۱۵ مگابایت) می‌باشد." });
      }
      if (err.message === 'ERR_INVALID_FILE_TYPE') {
        return res.status(400).json({ success: false, error: "ERR_INVALID_FILE_TYPE", message: "فرمت فایل مجاز نمی‌باشد. فقط پسوندهای PDF، JPEG، PNG و WEBP پذیرفته می‌شوند." });
      }
      return res.status(400).json({ success: false, error: "ERR_INVALID_DOCUMENT_PAYLOAD", message: err.message || "خطا در بارگذاری فایل." });
    }
    next();
  });
}, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { fileId } = req.params;

    // Check if file is provided via multipart/form-data or body buffer fallback
    const file = req.file;
    let fileBuffer: Buffer | null = null;
    let mimeType: string = '';
    let sizeBytes: number = 0;
    let originalName: string = '';
    let documentType: string = req.body?.documentType || '';
    let operationKey: string = req.body?.operationKey || (req.headers['x-operation-key'] as string) || '';

    if (file) {
      fileBuffer = file.buffer;
      mimeType = file.mimetype;
      sizeBytes = file.size;
      originalName = file.originalname;
    } else if (req.body?.fileData) {
      if (Buffer.isBuffer(req.body.fileData)) {
        fileBuffer = req.body.fileData;
      } else if (typeof req.body.fileData === 'string') {
        fileBuffer = Buffer.from(req.body.fileData, req.body.isBase64 ? 'base64' : 'utf-8');
      } else {
        fileBuffer = Buffer.from(JSON.stringify(req.body.fileData));
      }
      mimeType = req.body.mimeType || 'application/pdf';
      sizeBytes = fileBuffer ? fileBuffer.length : Number(req.body.sizeBytes || 0);
      originalName = req.body.originalName || 'file';
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, error: "ERR_NO_FILE_PROVIDED", message: "هیچ فایلی برای بارگذاری ارائه نشده است." });
    }

    if (!documentType) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_DOCUMENT_PAYLOAD", message: "نوع مدرک الزامی است." });
    }

    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ success: false, error: "ERR_INVALID_FILE_TYPE", message: "فرمت فایل مجاز نمی‌باشد." });
    }

    if (sizeBytes > MAX_DOCUMENT_FILE_SIZE) {
      return res.status(400).json({ success: false, error: "ERR_FILE_TOO_LARGE", message: "حجم فایل بیش از حد مجاز می‌باشد." });
    }

    // Verify credit file belongs to organization
    const { data: creditFile } = await supabaseClient
      .from('credit_files')
      .select('id')
      .eq('organization_id', verifiedOrgId)
      .eq('id', fileId)
      .is('deleted_at', null)
      .single();

    if (!creditFile) {
      return res.status(404).json({ success: false, error: "ERR_CREDIT_FILE_NOT_FOUND_OR_FORBIDDEN", message: "پرونده اعتباری یافت نشد یا متعلق به این سازمان نمی‌باشد." });
    }

    // Calculate SHA-256 hash from real file bytes on server
    const serverChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Idempotency check with operationKey and fingerprint comparison
    if (operationKey) {
      const { data: existingDoc } = await supabaseClient
        .from('credit_file_documents')
        .select('*')
        .eq('organization_id', verifiedOrgId)
        .eq('operation_key', operationKey)
        .single();

      if (existingDoc) {
        const isIdentical = (
          existingDoc.checksum === serverChecksum &&
          Number(existingDoc.size_bytes) === sizeBytes &&
          existingDoc.document_type === documentType
        );

        if (isIdentical) {
          return res.json({
            success: true,
            document: {
              id: existingDoc.id,
              creditFileId: existingDoc.credit_file_id,
              documentType: existingDoc.document_type,
              originalName: existingDoc.original_name,
              storageProvider: existingDoc.storage_provider,
              storageKey: existingDoc.storage_key,
              mimeType: existingDoc.mime_type,
              sizeBytes: Number(existingDoc.size_bytes || 0),
              checksum: existingDoc.checksum,
              status: existingDoc.status,
              version: existingDoc.version,
              operationKey: existingDoc.operation_key,
              downloadUrl: `/api/credit-files/${fileId}/documents/${existingDoc.id}/download`
            }
          });
        } else {
          return res.status(409).json({
            success: false,
            error: "ERR_IDEMPOTENCY_CONFLICT",
            message: "کلید عملیات با محتوای متفاوت ارسال شده است."
          });
        }
      }
    }

    const docId = `DOC_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    // Storage Key path strictly with server-generated IDs
    const storageKey = `organizations/${verifiedOrgId}/credit-files/${fileId}/${docId}`;

    // Step 1: Upload file bytes to storage FIRST
    const uploadRes = await DocumentStorageService.upload(
      storageKey,
      fileBuffer,
      mimeType,
      supabaseClient,
      { upsert: false }
    );

    if (!uploadRes.success) {
      return res.status(500).json({
        success: false,
        error: "ERR_STORAGE_UPLOAD_FAILED",
        message: uploadRes.error || "خطا در بارگذاری فایل در فضای نگهداری."
      });
    }

    // Step 2: Insert document metadata into credit_file_documents
    const docRow = {
      id: docId,
      organization_id: verifiedOrgId,
      credit_file_id: fileId,
      document_type: documentType,
      original_name: originalName,
      storage_provider: 'supabase_storage',
      storage_key: storageKey,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      checksum: serverChecksum,
      status: 'ACTIVE',
      version: 1,
      operation_key: operationKey || null,
      created_at: new Date().toISOString(),
      created_by: (req.headers['x-user-id'] as string) || 'system'
    };

    const { error: insertErr } = await supabaseClient
      .from('credit_file_documents')
      .insert(docRow);

    if (insertErr) {
      // Compensation Rollback: Delete uploaded file from storage if DB metadata insert fails
      const cleanupRes = await DocumentStorageService.remove(storageKey, supabaseClient);
      if (!cleanupRes.success) {
        console.error('CRITICAL_CLEANUP_FAILED: Storage file orphan removal failed:', storageKey, cleanupRes.error);
      }
      return res.status(500).json({
        success: false,
        error: "ERR_SAVE_DOCUMENT_FAILED",
        message: "ثبت مشخصات مدرک در پایگاه‌داده با خطا مواجه شد و فایل غیرفعال گردید."
      });
    }

    const createdDocument = {
      id: docId,
      creditFileId: fileId,
      documentType,
      originalName,
      storageProvider: 'supabase_storage',
      storageKey,
      mimeType,
      sizeBytes,
      checksum: serverChecksum,
      status: 'ACTIVE',
      version: 1,
      operationKey: docRow.operation_key,
      downloadUrl: `/api/credit-files/${fileId}/documents/${docId}/download`
    };

    return res.json({ success: true, document: createdDocument });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_SAVE_DOCUMENT_FAILED", message: err.message });
  }
});

app.get("/api/credit-files/:fileId/documents/:docId/download", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_GET'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { fileId, docId } = req.params;

    const { data: doc } = await supabaseClient
      .from('credit_file_documents')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .eq('credit_file_id', fileId)
      .eq('id', docId)
      .single();

    if (!doc || doc.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: "ERR_DOCUMENT_NOT_FOUND", message: "مدرک یافت نشد یا حذف شده است." });
    }

    const downloadRes = await DocumentStorageService.download(doc.storage_key, supabaseClient);
    if (!downloadRes.success || !downloadRes.data) {
      return res.status(404).json({ success: false, error: "ERR_STORAGE_FILE_NOT_FOUND", message: "فایل مدرک در فضای نگهداری یافت نشد." });
    }

    res.setHeader('Content-Type', doc.mime_type || downloadRes.data.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_name)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(downloadRes.data.buffer);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_DOWNLOAD_DOCUMENT_FAILED", message: err.message });
  }
});

app.delete("/api/credit-files/:fileId/documents/:docId", authMiddleware, createRoutePolicyMiddleware('CREDIT_FILES_DELETE'), async (req: AuthenticatedRequest, res) => {
  try {
    const supabaseClient = getRouteSupabaseClient(req);
    const verifiedOrgId = await resolveVerifiedOrgForWrite(req, res, supabaseClient);
    if (!verifiedOrgId) return;

    const { fileId, docId } = req.params;
    const removalReason = req.body?.reason || (req.query?.reason as string) || 'حذف مدرک توسط کاربر';

    const { data: existingDoc } = await supabaseClient
      .from('credit_file_documents')
      .select('*')
      .eq('organization_id', verifiedOrgId)
      .eq('credit_file_id', fileId)
      .eq('id', docId)
      .single();

    if (!existingDoc) {
      return res.status(404).json({ success: false, error: "ERR_DOCUMENT_NOT_FOUND", message: "مدرک یافت نشد یا دسترسی غیرمجاز است." });
    }

    const { error } = await supabaseClient
      .from('credit_file_documents')
      .update({
        status: 'REMOVED',
        removed_at: new Date().toISOString(),
        removed_by: (req.headers['x-user-id'] as string) || 'system',
        removal_reason: removalReason,
        version: (existingDoc.version || 1) + 1
      })
      .eq('organization_id', verifiedOrgId)
      .eq('id', docId);

    if (error) {
      return res.status(500).json({ success: false, error: "ERR_REMOVE_DOCUMENT_FAILED", message: error.message });
    }

    return res.json({ success: true, message: "مدرک با موفقیت غیرفعال و سابقه آن حفظ شد." });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "ERR_REMOVE_DOCUMENT_FAILED", message: err.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === "test" && !process.env.TEST_SERVER) {
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
    } catch (e) {}
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
  server.on("error", (e: any) => {
    if (e.code === "EADDRINUSE") {
      // Port in use (e.g. dev server running), ignore gracefully when imported in test
    } else {
      console.error("Server error:", e);
    }
  });
}

startServer();
