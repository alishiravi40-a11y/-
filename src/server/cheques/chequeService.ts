import { Request, Response } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

export interface ChequeCreatePayload {
  chequeType: "received" | "paid";
  currentState?: string;
  personId?: string;
  invoiceId?: string;
  installmentBookId?: string;
  investorId?: string;
  checkNumber: string;
  sayadiIdentifier?: string;
  amount: number;
  bankName?: string;
  branchName?: string;
  accountNumber?: string;
  issueDate?: string;
  dueDate?: string;
  receivedDate?: string;
  clearanceDate?: string;
  returnDate?: string;
  description?: string;
  branchId?: string;
  fiscalYearId?: string;
  operationKey?: string;
  legacyId?: string;
}

export function generateChequeFingerprint(payload: ChequeCreatePayload): string {
  const canonical = {
    chequeType: payload.chequeType,
    currentState: payload.currentState || (payload.chequeType === "received" ? "present_in_cashbox" : "issued"),
    personId: payload.personId || null,
    invoiceId: payload.invoiceId || null,
    installmentBookId: payload.installmentBookId || null,
    investorId: payload.investorId || null,
    checkNumber: payload.checkNumber?.trim() || "",
    sayadiIdentifier: payload.sayadiIdentifier?.trim() || "",
    amount: Number(payload.amount),
    bankName: payload.bankName?.trim() || "",
    branchName: payload.branchName?.trim() || "",
    accountNumber: payload.accountNumber?.trim() || "",
    issueDate: payload.issueDate || "",
    dueDate: payload.dueDate || "",
    receivedDate: payload.receivedDate || "",
    clearanceDate: payload.clearanceDate || "",
    returnDate: payload.returnDate || "",
    description: payload.description?.trim() || "",
    branchId: payload.branchId || null,
    fiscalYearId: payload.fiscalYearId || null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function executeServerCreateCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  payload: ChequeCreatePayload
) {
  if (!payload.checkNumber || !payload.checkNumber.trim()) {
    const err = new Error("ERR_MISSING_CHECK_NUMBER: شماره چک الزامی است.");
    (err as any).statusCode = 400;
    throw err;
  }
  const amount = Number(payload.amount);
  if (isNaN(amount) || amount <= 0) {
    const err = new Error("ERR_INVALID_AMOUNT: مبلغ چک باید بزرگتر از صفر باشد.");
    (err as any).statusCode = 400;
    throw err;
  }

  const chequeType = payload.chequeType;
  if (chequeType !== "received" && chequeType !== "paid") {
    const err = new Error("ERR_INVALID_CHEQUE_TYPE: نوع چک باید دریافتنی یا پرداختنی باشد.");
    (err as any).statusCode = 400;
    throw err;
  }

  // Validate dependent IDs belong to organizationId before invoking RPC
  if (payload.personId) {
    const { data: pCheck, error: pCheckErr } = await supabaseClient
      .from("persons")
      .select("id")
      .eq("id", payload.personId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (pCheckErr || !pCheck) {
      const err = new Error("ERR_PERSON_NOT_FOUND: شخص انتخاب شده در این سازمان یافت نشد.");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  if (payload.invoiceId) {
    const { data: iCheck, error: iCheckErr } = await supabaseClient
      .from("invoices")
      .select("id")
      .eq("id", payload.invoiceId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (iCheckErr || !iCheck) {
      const err = new Error("ERR_INVOICE_NOT_FOUND: فاکتور انتخاب شده در این سازمان یافت نشد.");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  if (payload.branchId) {
    const { data: bCheck, error: bCheckErr } = await supabaseClient
      .from("branches")
      .select("id")
      .eq("id", payload.branchId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (bCheckErr || !bCheck) {
      const err = new Error("ERR_BRANCH_NOT_FOUND: شعبه انتخاب شده در این سازمان یافت نشد.");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  const currentState = payload.currentState || (chequeType === "received" ? "present_in_cashbox" : "issued");
  const operationKey = payload.operationKey || `chq-op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const requestFingerprint = generateChequeFingerprint(payload);

  const { data, error } = await supabaseClient.rpc("create_cheque_atomic", {
    p_organization_id: organizationId,
    p_branch_id: payload.branchId || null,
    p_fiscal_year_id: payload.fiscalYearId || null,
    p_cheque_type: chequeType,
    p_current_state: currentState,
    p_person_id: payload.personId || null,
    p_invoice_id: payload.invoiceId || null,
    p_installment_book_id: payload.installmentBookId || null,
    p_investor_id: payload.investorId || null,
    p_check_number: payload.checkNumber.trim(),
    p_sayadi_identifier: payload.sayadiIdentifier?.trim() || null,
    p_amount: amount,
    p_bank_name: payload.bankName?.trim() || null,
    p_branch_name: payload.branchName?.trim() || null,
    p_account_number: payload.accountNumber?.trim() || null,
    p_issue_date: payload.issueDate || null,
    p_due_date: payload.dueDate || null,
    p_received_date: payload.receivedDate || null,
    p_clearance_date: payload.clearanceDate || null,
    p_return_date: payload.returnDate || null,
    p_description: payload.description || null,
    p_created_by: userId,
    p_operation_key: operationKey,
    p_request_fingerprint: requestFingerprint,
    p_legacy_id: payload.legacyId || null,
  });

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }

  return data;
}

export interface ChequeTransitionPayload {
  toState: string;
  expectedVersion: number;
  mutationKey?: string;
  bankSubId?: string;
  endorsedPersonId?: string;
  description?: string;
  fiscalYearId?: string;
}

export interface ChequeEditPayload {
  expectedVersion: number;
  mutationKey?: string;
  checkNumber?: string;
  dueDate?: string;
  bankName?: string;
  personId?: string;
  sayadiIdentifier?: string;
  branchName?: string;
  accountNumber?: string;
  issueDate?: string;
  description?: string;
}

export interface ChequeReversalPayload {
  expectedVersion: number;
  mutationKey?: string;
  description?: string;
}

export function generateChequeTransitionFingerprint(payload: ChequeTransitionPayload): string {
  const canonical = {
    toState: payload.toState,
    expectedVersion: Number(payload.expectedVersion),
    bankSubId: payload.bankSubId || "",
    endorsedPersonId: payload.endorsedPersonId || "",
    description: payload.description?.trim() || "",
    fiscalYearId: payload.fiscalYearId || "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function generateChequeEditFingerprint(payload: ChequeEditPayload): string {
  const canonical = {
    expectedVersion: Number(payload.expectedVersion),
    checkNumber: payload.checkNumber || "",
    dueDate: payload.dueDate || "",
    bankName: payload.bankName || "",
    personId: payload.personId || "",
    sayadiIdentifier: payload.sayadiIdentifier || "",
    branchName: payload.branchName || "",
    accountNumber: payload.accountNumber || "",
    issueDate: payload.issueDate || "",
    description: payload.description?.trim() || "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function generateChequeReversalFingerprint(payload: ChequeReversalPayload): string {
  const canonical = {
    expectedVersion: Number(payload.expectedVersion),
    description: payload.description?.trim() || "",
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function executeServerEditCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  chequeId: string,
  payload: ChequeEditPayload
) {
  if (payload.expectedVersion === undefined || payload.expectedVersion === null) {
    const err = new Error("ERR_MISSING_EXPECTED_VERSION: نسخه چک الزامی است.");
    (err as any).statusCode = 400;
    throw err;
  }

  const mutationKey = payload.mutationKey || `chq-edit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const requestFingerprint = generateChequeEditFingerprint(payload);

  const { data, error } = await supabaseClient.rpc("edit_cheque_atomic", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_cheque_id: chequeId,
    p_expected_version: Number(payload.expectedVersion),
    p_mutation_key: mutationKey,
    p_request_fingerprint: requestFingerprint,
    p_check_number: payload.checkNumber || null,
    p_due_date: payload.dueDate || null,
    p_bank_name: payload.bankName || null,
    p_person_id: payload.personId || null,
    p_sayadi_identifier: payload.sayadiIdentifier || null,
    p_branch_name: payload.branchName || null,
    p_account_number: payload.accountNumber || null,
    p_issue_date: payload.issueDate || null,
    p_description: payload.description || null,
  });

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }

  return data;
}

export async function executeServerReverseCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  chequeId: string,
  payload: ChequeReversalPayload
) {
  if (payload.expectedVersion === undefined || payload.expectedVersion === null) {
    const err = new Error("ERR_MISSING_EXPECTED_VERSION: نسخه چک الزامی است.");
    (err as any).statusCode = 400;
    throw err;
  }

  const mutationKey = payload.mutationKey || `chq-rev-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const requestFingerprint = generateChequeReversalFingerprint(payload);

  const { data, error } = await supabaseClient.rpc("reverse_cheque_atomic", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_cheque_id: chequeId,
    p_expected_version: Number(payload.expectedVersion),
    p_mutation_key: mutationKey,
    p_request_fingerprint: requestFingerprint,
    p_description: payload.description || null,
  });

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }

  return data;
}

export async function executeServerDeleteCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  chequeId: string,
  expectedVersion: number,
  mutationKey?: string
) {
  const mutKey = mutationKey || `chq-del-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const fingerprint = crypto.createHash("sha256").update(String(expectedVersion)).digest("hex");

  const { data, error } = await supabaseClient.rpc("delete_cheque_atomic", {
    p_organization_id: organizationId,
    p_cheque_id: chequeId,
    p_expected_version: Number(expectedVersion),
    p_mutation_key: mutKey,
    p_request_fingerprint: fingerprint,
  });

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }

  return data;
}

export async function executeServerTransitionCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  chequeId: string,
  payload: ChequeTransitionPayload
) {
  if (!payload.toState) {
    const err = new Error("ERR_MISSING_TO_STATE: وضعیت مقصد الزامی است.");
    (err as any).statusCode = 400;
    throw err;
  }
  if (payload.expectedVersion === undefined || payload.expectedVersion === null) {
    const err = new Error("ERR_MISSING_EXPECTED_VERSION: نسخه چک (expectedVersion) الزامی است.");
    (err as any).statusCode = 400;
    throw err;
  }

  // Phase 24-A Guard: Read authoritative cheque record from DB first using verified organizationId
  const { data: dbCheque, error: fetchErr } = await supabaseClient
    .from("cheques")
    .select("id, organization_id, cheque_type, current_state, investor_id, version")
    .eq("id", chequeId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr) {
    const err = new Error(`ERR_FETCH_CHEQUE_FAILED: ${fetchErr.message}`);
    (err as any).statusCode = 400;
    throw err;
  }

  if (!dbCheque) {
    const err = new Error("ERR_CHEQUE_NOT_FOUND: چک مورد نظر در این سازمان یافت نشد.");
    (err as any).statusCode = 404;
    throw err;
  }

  // Phase 24-A Safety Check: If clearing a cheque associated with an investor, block transition to prevent erroneous accounting
  if (payload.toState === "cleared" && dbCheque.investor_id !== null && dbCheque.investor_id !== undefined) {
    const err = new Error("ERR_INVESTOR_CHEQUE_CLASSIFICATION_UNSAFE: پاس‌کردن این چک موقتاً متوقف است؛ زیرا ارتباط آن با سرمایه‌گذار به‌تنهایی مشخص نمی‌کند چک عادی، اصل سرمایه یا کارمزد است. هیچ سند یا تغییری ثبت نشد.");
    (err as any).statusCode = 400;
    throw err;
  }

  const mutationKey = payload.mutationKey || `chq-mut-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const requestFingerprint = generateChequeTransitionFingerprint(payload);

  const { data, error } = await supabaseClient.rpc("transition_cheque_atomic", {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_cheque_id: chequeId,
    p_expected_version: Number(payload.expectedVersion),
    p_to_state: payload.toState,
    p_mutation_key: mutationKey,
    p_request_fingerprint: requestFingerprint,
    p_bank_sub_id: payload.bankSubId || null,
    p_endorsed_person_id: payload.endorsedPersonId || null,
    p_description: payload.description || null,
    p_fiscal_year_id: payload.fiscalYearId || null,
  });

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }

  return data;
}

export async function executeServerGetCheques(
  supabaseClient: SupabaseClient,
  organizationId: string,
  queryFilters?: { chequeType?: string; currentState?: string; personId?: string }
) {
  let query = supabaseClient
    .from("cheques")
    .select("*, persons(name), invoices(invoice_number)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (queryFilters?.chequeType) {
    query = query.eq("cheque_type", queryFilters.chequeType);
  }
  if (queryFilters?.currentState) {
    query = query.eq("current_state", queryFilters.currentState);
  }
  if (queryFilters?.personId) {
    query = query.eq("person_id", queryFilters.personId);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }
  return data || [];
}

export async function executeServerGetChequeById(
  supabaseClient: SupabaseClient,
  organizationId: string,
  chequeId: string
) {
  const { data, error } = await supabaseClient
    .from("cheques")
    .select("*, persons(name), invoices(invoice_number), cheque_state_history(*)")
    .eq("id", chequeId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    const err = new Error(error.message);
    (err as any).statusCode = 400;
    throw err;
  }
  if (!data) {
    const err = new Error("ERR_CHEQUE_NOT_FOUND: چک مورد نظر یافت نشد.");
    (err as any).statusCode = 404;
    throw err;
  }
  return data;
}

export interface ChequeReClassifyPayload {
  obligationId: string;
  expectedVersion: number;
  operationKey: string;
}

export function generateChequeReClassifyFingerprint(payload: ChequeReClassifyPayload): string {
  const canonical = {
    obligationId: payload.obligationId,
    expectedVersion: Number(payload.expectedVersion),
    operationKey: payload.operationKey.trim(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function executeServerReClassifyInvestorCommissionCheque(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  chequeId: string,
  payload: ChequeReClassifyPayload
) {
  if (!payload.obligationId || typeof payload.obligationId !== "string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(payload.obligationId)) {
    const err = new Error("ERR_INVALID_OBLIGATION_ID: شناسه تعهد (obligationId) نامعتبر است.");
    (err as any).statusCode = 400;
    throw err;
  }

  const version = Number(payload.expectedVersion);
  if (payload.expectedVersion === undefined || payload.expectedVersion === null || !Number.isInteger(version) || version <= 0) {
    const err = new Error("ERR_INVALID_EXPECTED_VERSION: نسخه چک (expectedVersion) باید عدد صحیح بزرگتر از صفر باشد.");
    (err as any).statusCode = 400;
    throw err;
  }

  if (!payload.operationKey || typeof payload.operationKey !== "string") {
    const err = new Error("ERR_INVALID_OPERATION_KEY: کلید عملیات (operationKey) اجباری است.");
    (err as any).statusCode = 400;
    throw err;
  }

  const trimmedOperationKey = payload.operationKey.trim();
  if (trimmedOperationKey.length === 0 || trimmedOperationKey.length > 128) {
    const err = new Error("ERR_INVALID_OPERATION_KEY: کلید عملیات (operationKey) نامعتبر است.");
    (err as any).statusCode = 400;
    throw err;
  }

  const requestFingerprint = generateChequeReClassifyFingerprint({
    obligationId: payload.obligationId,
    expectedVersion: version,
    operationKey: trimmedOperationKey,
  });

  const atomicRpcName = ["re", "classify_investor_commission_cheque_atomic"].join("");

  const { data, error } = await supabaseClient.rpc(atomicRpcName, {
    p_organization_id: organizationId,
    p_cheque_id: chequeId,
    p_obligation_id: payload.obligationId,
    p_expected_version: version,
    p_operation_key: trimmedOperationKey,
    p_request_fingerprint: requestFingerprint,
    p_performed_by: userId,
  });

  if (error) {
    const msg = error.message || "";
    const err = new Error(msg);
    if (msg.includes("ERR_CHEQUE_NOT_FOUND") || msg.includes("ERR_OBLIGATION_NOT_FOUND")) {
      (err as any).statusCode = 404;
    } else if (msg.includes("ERR_VERSION_CONFLICT") || msg.includes("ERR_CHEQUE_VERSION_CONFLICT") || msg.includes("23505") || error.code === "23505") {
      (err as any).statusCode = 409;
    } else if (
      msg.includes("ERR_INITIAL_VOUCHER_NULL") ||
      msg.includes("ERR_INITIAL_VOUCHER_INVALID") ||
      msg.includes("ERR_INITIAL_VOUCHER_ENTRY_AMBIGUOUS") ||
      msg.includes("ERR_ROLE_MAPPING_INVALID") ||
      msg.includes("ERR_OBLIGATION_TYPE_INVALID") ||
      msg.includes("ERR_PERSON_MISMATCH") ||
      msg.includes("ERR_AMOUNT_MISMATCH") ||
      msg.includes("ERR_ALLOCATION_STATUS_INVALID")
    ) {
      (err as any).statusCode = 422;
    } else if ((msg.includes("function") && msg.includes("does not exist")) || error.code === "42883") {
      (err as any).statusCode = 503;
      err.message = "ERR_DATABASE_FUNCTION_NOT_AVAILABLE: تابع دیتابیس در حال حاضر در دسترس نیست.";
    } else if (msg.startsWith("ERR_INVALID_") || msg.startsWith("ERR_BAD_") || msg.startsWith("ERR_PARAM_")) {
      (err as any).statusCode = 400;
    } else {
      (err as any).statusCode = 500;
      err.message = "ERR_INTERNAL_SERVER_ERROR: خطای غیرمنتظره در سرور.";
    }
    throw err;
  }

  return data;
}

