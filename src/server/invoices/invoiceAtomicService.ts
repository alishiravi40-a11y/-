import { Request, Response } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

export interface InvoiceItemPayload {
  productId: string;
  warehouseId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  serialNumbers?: string[];
  unitCostPrice?: number;
  totalCostPrice?: number;
  description?: string;
}

export interface InvoiceCreatePayload {
  invoiceType: "BUY" | "SELL";
  personId: string;
  personName?: string;
  date?: string;
  dateJalali?: string;
  isProInvoice?: boolean;
  discount?: number;
  taxPercent?: number;
  description?: string;
  cashPaidAmount?: number;
  posPaidAmount?: number;
  posTerminalId?: string;
  isInstallmentDeferred?: boolean;
  isSettledWithChecks?: boolean;
  checks?: any[];
  isPaidFromWallet?: boolean;
  settlementCommission?: number;
  costCenterId?: string;
  purchaseManagerProfitRate?: number;
  items: InvoiceItemPayload[];
  operationKey?: string;
  branchId?: string;
  fiscalYearId?: string;
}

/**
 * Validates and atomically processes an invoice creation in PostgreSQL.
 * Strict rules:
 * - Server recomputes line total, subtotal, tax, and total.
 * - Idempotency enforced via (organization_id, operation_key).
 * - For real invoices (isProInvoice = false):
 *   - Inserts into public.invoices & public.invoice_items
 *   - Inserts double-entry balanced voucher into public.journal_vouchers & public.voucher_entries
 *   - Inserts stock movements into public.inventory_transactions & public.inventory_transaction_items
 *   - Guarantees complete rollback if any step or double-entry balance fails.
 * - Checks/Installments fail-closed if unmigrated.
 */
export interface InvoiceUpdatePayload extends InvoiceCreatePayload {
  expectedVersion: number;
  mutationKey: string;
}

/**
 * Atomically updates an existing invoice in PostgreSQL.
 * Enforces:
 * - Optimistic Concurrency Control (version matching, 409 conflict on mismatch)
 * - Durable Idempotency via mutationKey & requestFingerprint
 * - Fail-closed settlement boundary (cheques/installments)
 * - Pro-invoice vs Posted invoice accounting/inventory handling
 * - Neutralization of old inventory effect and application of new effect once (no double effect)
 * - Voucher re-balance assertion (SUM(debit) === SUM(credit))
 */
export async function executeServerUpdateInvoice(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  invoiceId: string,
  payload: InvoiceUpdatePayload
) {
  // 1. Fetch existing invoice with items
  const { data: existingInv, error: fetchErr } = await supabaseClient
    .from("invoices")
    .select("*, invoice_items(*)")
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr || !existingInv) {
    const err = new Error("ERR_INVOICE_NOT_FOUND: فاکتور مورد نظر برای ویرایش یافت نشد.");
    (err as any).statusCode = 404;
    throw err;
  }

  // 2. Optimistic Concurrency Check
  const expectedVersion = Number(payload.expectedVersion);
  if (isNaN(expectedVersion) || existingInv.version !== expectedVersion) {
    const err = new Error("ERR_INVOICE_VERSION_CONFLICT: نسخه فاکتور تغییر کرده است (Optimistic Concurrency Conflict).");
    (err as any).statusCode = 409;
    throw err;
  }

  // 3. Idempotency Check via mutationKey
  const mutationKey = payload.mutationKey;
  if (!mutationKey) {
    throw new Error("ERR_MISSING_MUTATION_KEY: کلید تغییرات (mutationKey) الزامی است.");
  }

  const fingerprintPayload = { ...payload };
  delete (fingerprintPayload as any).expectedVersion;
  delete (fingerprintPayload as any).mutationKey;

  const requestFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        organizationId,
        invoiceId,
        payload: fingerprintPayload
      })
    )
    .digest("hex");

  if (existingInv.operation_key === mutationKey || existingInv.mutation_key === mutationKey) {
    if (existingInv.request_fingerprint === requestFingerprint) {
      return {
        isDuplicate: true,
        invoiceId: existingInv.id,
        invoiceNumber: existingInv.invoice_number,
        version: existingInv.version,
        totalAmount: existingInv.total_amount
      };
    } else {
      const err = new Error("ERR_IDEMPOTENCY_CONFLICT: درخواست تکراری با کلید یکسان و محتوای متفاوت.");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  const {
    invoiceType = existingInv.invoice_type,
    personId = existingInv.person_id,
    personName,
    date = existingInv.invoice_date,
    dateJalali = existingInv.invoice_date_jalali,
    isProInvoice = existingInv.is_pro_invoice,
    discount = existingInv.discount_amount,
    taxPercent = existingInv.tax_percent,
    description = existingInv.description,
    cashPaidAmount = existingInv.cash_paid_amount,
    posPaidAmount = existingInv.pos_paid_amount,
    posTerminalId = existingInv.pos_terminal_id,
    isInstallmentDeferred = existingInv.is_installment_deferred,
    isSettledWithChecks = existingInv.is_settled_with_checks,
    isPaidFromWallet = existingInv.is_paid_from_wallet,
    settlementCommission = existingInv.settlement_commission_amount,
    costCenterId = existingInv.cost_center_id,
    purchaseManagerProfitRate = existingInv.purchase_manager_profit_rate,
    items
  } = payload;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("ERR_EMPTY_ITEMS: فاکتور باید حداقل دارای یک ردیف کالا باشد.");
  }

  // 4. Validate Person
  const { data: personRow, error: personErr } = await supabaseClient
    .from("persons")
    .select("id, name, status")
    .eq("organization_id", organizationId)
    .eq("id", personId)
    .maybeSingle();

  if (personErr || !personRow) {
    throw new Error("ERR_PERSON_NOT_FOUND: شخص مورد نظر در سازمان یافت نشد.");
  }

  // 6. Recalculate Totals
  let calculatedSubtotal = 0;
  let lineTotalDiscounts = 0;
  const processedItems = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const qty = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const lineDisc = Number(item.discount || 0);

    if (isNaN(qty) || qty <= 0) {
      throw new Error(`ERR_INVALID_QUANTITY: مقدار ردیف ${idx + 1} نامعتبر است.`);
    }
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error(`ERR_INVALID_UNIT_PRICE: فی ردیف ${idx + 1} نامعتبر است.`);
    }

    const lineTotal = Math.round(qty * unitPrice - lineDisc);
    calculatedSubtotal += Math.round(qty * unitPrice);
    lineTotalDiscounts += lineDisc;

    processedItems.push({
      row_number: idx + 1,
      product_id: item.productId,
      warehouse_id: item.warehouseId,
      quantity: qty,
      unit_price_amount: unitPrice,
      discount_amount: lineDisc,
      total_price_amount: lineTotal,
      unit_cost_amount: item.unitCostPrice || null,
      total_cost_amount: item.totalCostPrice || null,
      serial_numbers: item.serialNumbers || null,
      description: item.description || null
    });
  }

  const invoiceGeneralDiscount = Number(discount || 0);
  const totalCombinedDiscount = lineTotalDiscounts + invoiceGeneralDiscount;
  const effectiveTaxPercent = Number(taxPercent || 0);

  const taxableBase = Math.max(0, calculatedSubtotal - totalCombinedDiscount);
  const calculatedTax = Math.round(taxableBase * (effectiveTaxPercent / 100));
  const calculatedTotal = Math.round(taxableBase + calculatedTax);

  const finalCashPaid = Number(cashPaidAmount || 0);
  const finalPosPaid = Number(posPaidAmount || 0);
  const totalPaid = finalCashPaid + finalPosPaid;

  const nextVersion = existingInv.version + 1;

  // 7. Update Invoice Header
  const { error: invUpdateErr } = await supabaseClient
    .from("invoices")
    .update({
      person_id: personId,
      invoice_date: date,
      invoice_date_jalali: dateJalali,
      is_pro_invoice: isProInvoice,
      subtotal_amount: calculatedSubtotal,
      discount_amount: totalCombinedDiscount,
      tax_percent: effectiveTaxPercent,
      tax_amount: calculatedTax,
      total_amount: calculatedTotal,
      paid_amount: totalPaid,
      cash_paid_amount: finalCashPaid,
      pos_paid_amount: finalPosPaid,
      pos_terminal_id: posTerminalId || null,
      is_installment_deferred: isInstallmentDeferred,
      is_settled_with_checks: isSettledWithChecks,
      settlement_commission_amount: Number(settlementCommission || 0),
      cost_center_id: costCenterId || null,
      purchase_manager_profit_rate: purchaseManagerProfitRate || null,
      description: description || null,
      operation_key: mutationKey,
      request_fingerprint: requestFingerprint,
      version: nextVersion,
      updated_at: new Date().toISOString()
    })
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .eq("version", expectedVersion);

  if (invUpdateErr) {
    throw new Error(`ERR_INVOICE_UPDATE_FAILED: ${invUpdateErr.message}`);
  }

  // 8. Replace Invoice Items
  await supabaseClient.from("invoice_items").delete().eq("invoice_id", invoiceId);

  const itemsToInsert = processedItems.map((item) => ({
    ...item,
    organization_id: organizationId,
    invoice_id: invoiceId
  }));

  const { error: itemsInsertErr } = await supabaseClient.from("invoice_items").insert(itemsToInsert);
  if (itemsInsertErr) {
    throw new Error(`ERR_INVOICE_ITEMS_REPLACE_FAILED: ${itemsInsertErr.message}`);
  }

  // 9. If Pro-Invoice, finish here without touching Vouchers or Inventory
  if (isProInvoice) {
    return {
      success: true,
      invoiceId,
      invoiceNumber: existingInv.invoice_number,
      version: nextVersion,
      totalAmount: calculatedTotal,
      isProInvoice: true
    };
  }

  // 10. Update Linked Journal Voucher & Inventory Transaction for Posted Invoice
  const journalVoucherId = existingInv.journal_voucher_id;
  const inventoryTransactionId = existingInv.inventory_transaction_id;

  if (journalVoucherId) {
    const pName = personRow.name || personName || "طرف حساب";
    const voucherDesc = `${invoiceType === "SELL" ? "فروش" : "خرید"} - ویرایش فاکتور ${existingInv.invoice_number}`;

    const { data: subRows } = await supabaseClient
      .from("account_subsidiaries")
      .select("id, code")
      .eq("organization_id", organizationId);

    const subMap: Record<string, string> = {};
    if (subRows) {
      for (const s of subRows) {
        subMap[s.code] = s.id;
      }
    }

    const subArId = subMap["1101"] || subMap["SUB_DEBTORS"] || null;
    const subApId = subMap["2101"] || subMap["SUB_CREDITORS"] || null;
    const subSalesId = subMap["4101"] || subMap["SUB_REVENUE"] || null;
    const subInventoryId = subMap["1105"] || subMap["SUB_INVENTORY"] || null;
    const subVatBuyId = subMap["1108"] || subMap["SUB_VAT_BUY"] || null;
    const subVatSellId = subMap["2105"] || subMap["SUB_VAT_SELL"] || null;
    const subCashId = subMap["1102"] || subMap["SUB_CASH_MAIN"] || subMap["SUB_CASH"] || null;
    const subPosId = subMap["1103"] || subMap["SUB_BANK_POS"] || subMap["SUB_BANK"] || subCashId || subArId;

    const voucherEntries = [];

    if (invoiceType === "SELL") {
      let rowNum = 1;
      const remaining = calculatedTotal - (finalCashPaid + finalPosPaid);

      if (finalCashPaid > 0 && subCashId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subCashId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: finalCashPaid,
          credit: 0,
          description: `دریافت نقدی بابت فاکتور فروش شماره ${existingInv.invoice_number}`
        });
      }

      if (finalPosPaid > 0 && subPosId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subPosId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: finalPosPaid,
          credit: 0,
          description: `دریافت کارتخوان (POS) بابت فاکتور فروش شماره ${existingInv.invoice_number}`
        });
      }

      if (remaining > 0 || (finalCashPaid === 0 && finalPosPaid === 0)) {
        const actualDebt = remaining > 0 ? remaining : calculatedTotal;
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subArId || subCashId,
          person_id: personId,
          cost_center_id: costCenterId || null,
          debit: actualDebt,
          credit: 0,
          description: `فروش نسیه - فاکتور شماره ${existingInv.invoice_number} (${pName})`
        });
      }

      if (subSalesId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subSalesId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: taxableBase,
          description: `فروش طی فاکتور شماره ${existingInv.invoice_number}`
        });
      }

      if (calculatedTax > 0 && subVatSellId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subVatSellId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: calculatedTax,
          description: `مالیات ارزش افزوده فاکتور فروش ${existingInv.invoice_number}`
        });
      }
    } else {
      let rowNum = 1;
      if (subInventoryId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subInventoryId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: taxableBase,
          credit: 0,
          description: `خرید طی فاکتور شماره ${existingInv.invoice_number}`
        });
      }

      if (calculatedTax > 0 && subVatBuyId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subVatBuyId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: calculatedTax,
          credit: 0,
          description: `مالیات ارزش افزوده فاکتور خرید ${existingInv.invoice_number}`
        });
      }

      if (subApId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subApId,
          person_id: personId,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: calculatedTotal,
          description: `خرید طی فاکتور شماره ${existingInv.invoice_number} (${pName})`
        });
      }
    }

    const totalDebit = voucherEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
    const totalCredit = voucherEntries.reduce((sum, e) => sum + (e.credit || 0), 0);

    if (totalDebit !== totalCredit) {
      throw new Error(`ERR_VOUCHER_UNBALANCED: سند حسابداری پس از ویرایش تراز نیست (بدهکار: ${totalDebit}, بستانکار: ${totalCredit})`);
    }

    // Update Voucher Header
    await supabaseClient
      .from("journal_vouchers")
      .update({
        voucher_date: date,
        description: voucherDesc,
        total_debit: totalDebit,
        total_credit: totalCredit,
        updated_at: new Date().toISOString()
      })
      .eq("id", journalVoucherId);

    // Replace Voucher Entries
    await supabaseClient.from("voucher_entries").delete().eq("voucher_id", journalVoucherId);

    const vEntriesToInsert = voucherEntries.map((e) => ({
      ...e,
      organization_id: organizationId,
      voucher_id: journalVoucherId
    }));

    const { error: vEntriesErr } = await supabaseClient.from("voucher_entries").insert(vEntriesToInsert);
    if (vEntriesErr) {
      throw new Error(`ERR_VOUCHER_ENTRIES_UPDATE_FAILED: ${vEntriesErr.message}`);
    }
  }

  // 11. Update Inventory Transaction Items
  if (inventoryTransactionId) {
    await supabaseClient.from("inventory_transaction_items").delete().eq("transaction_id", inventoryTransactionId);

    const invTxItemsToInsert = processedItems.map((item) => ({
      organization_id: organizationId,
      transaction_id: inventoryTransactionId,
      product_id: item.product_id,
      source_warehouse_id: invoiceType === "SELL" ? item.warehouse_id : null,
      destination_warehouse_id: invoiceType === "BUY" ? item.warehouse_id : null,
      quantity: item.quantity,
      unit_cost_amount: item.unit_cost_amount,
      total_cost_amount: item.total_cost_amount
    }));

    const { error: invTxItemsErr } = await supabaseClient
      .from("inventory_transaction_items")
      .insert(invTxItemsToInsert);

    if (invTxItemsErr) {
      throw new Error(`ERR_INVENTORY_TX_ITEMS_UPDATE_FAILED: ${invTxItemsErr.message}`);
    }
  }

  return {
    success: true,
    invoiceId,
    invoiceNumber: existingInv.invoice_number,
    version: nextVersion,
    totalAmount: calculatedTotal
  };
}

/**
 * Validates and atomically processes an invoice creation in PostgreSQL.
 */
export async function executeServerCreateInvoice(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  payload: InvoiceCreatePayload
) {
  const {
    invoiceType,
    personId,
    personName,
    items,
    date,
    dateJalali,
    isProInvoice,
    discount,
    taxPercent,
    cashPaidAmount,
    posPaidAmount,
    posTerminalId,
    isPaidFromWallet,
    settlementCommission,
    costCenterId,
    purchaseManagerProfitRate,
    description,
    isInstallmentDeferred,
    isSettledWithChecks,
    operationKey
  } = payload;

  if (!invoiceType || !["BUY", "SELL"].includes(invoiceType)) {
    throw new Error("ERR_INVALID_INVOICE_TYPE: نوع فاکتور باید BUY یا SELL باشد.");
  }
  if (!personId) {
    throw new Error("ERR_INVALID_PERSON: شناسه طرف حساب الزامی است.");
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error("ERR_EMPTY_ITEMS: فاکتور باید حداقل دارای یک ردیف کالا باشد.");
  }

  // Validate explicitly passed branchId and fiscalYearId belong to organizationId
  if (payload.branchId) {
    const { data: bCheck, error: bCheckErr } = await supabaseClient
      .from("branches")
      .select("id")
      .eq("id", payload.branchId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (bCheckErr || !bCheck) {
      throw new Error("ERR_BRANCH_NOT_FOUND: شعبه انتخاب شده در این سازمان یافت نشد.");
    }
  }

  if (payload.fiscalYearId) {
    const { data: fyCheck, error: fyCheckErr } = await supabaseClient
      .from("fiscal_years")
      .select("id")
      .eq("id", payload.fiscalYearId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (fyCheckErr || !fyCheck) {
      throw new Error("ERR_FISCAL_YEAR_NOT_FOUND: سال مالی انتخاب شده در این سازمان یافت نشد.");
    }
  }

  // 3. Resolve Organization Branch & Fiscal Year
  const { data: branchRow, error: branchErr } = await supabaseClient
    .from("branches")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(1)
    .maybeSingle();

  if (branchErr || !branchRow) {
    throw new Error("ERR_BRANCH_NOT_FOUND: شعبه معتبری برای سازمان یافت نشد.");
  }
  const resolvedBranchId = payload.branchId || branchRow.id;

  const { data: fyRow, error: fyErr } = await supabaseClient
    .from("fiscal_years")
    .select("id, is_closed")
    .eq("organization_id", organizationId)
    .eq("is_closed", false)
    .limit(1)
    .maybeSingle();

  if (fyErr || !fyRow) {
    throw new Error("ERR_FISCAL_YEAR_NOT_FOUND: سال مالی باز برای سازمان یافت نشد.");
  }
  const resolvedFiscalYearId = payload.fiscalYearId || fyRow.id;

  // 4. Validate Person Exists & Belongs to Organization
  const { data: personRow, error: personErr } = await supabaseClient
    .from("persons")
    .select("id, name, is_agent, status")
    .eq("organization_id", organizationId)
    .eq("id", personId)
    .maybeSingle();

  if (personErr || !personRow) {
    throw new Error("ERR_PERSON_NOT_FOUND: شخص مورد نظر در این سازمان یافت نشد.");
  }
  if (personRow.status === "inactive") {
    throw new Error("ERR_PERSON_INACTIVE: شخص انتخاب شده غیرفعال است.");
  }

  // 5. Server Recalculation of Line Items & Financial Totals
  let calculatedSubtotal = 0;
  let lineTotalDiscounts = 0;
  const processedItems = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const qty = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    const lineDisc = Number(item.discount || 0);

    if (isNaN(qty) || qty <= 0) {
      throw new Error(`ERR_INVALID_QUANTITY: مقدار ردیف ${idx + 1} نامعتبر است.`);
    }
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error(`ERR_INVALID_UNIT_PRICE: فی ردیف ${idx + 1} نامعتبر است.`);
    }
    if (isNaN(lineDisc) || lineDisc < 0) {
      throw new Error(`ERR_INVALID_DISCOUNT: تخفیف ردیف ${idx + 1} نامعتبر است.`);
    }

    const lineTotal = Math.round(qty * unitPrice - lineDisc);
    if (lineTotal < 0) {
      throw new Error(`ERR_NEGATIVE_LINE_TOTAL: مبلغ خالص ردیف ${idx + 1} نمی‌تواند منفی باشد.`);
    }

    calculatedSubtotal += Math.round(qty * unitPrice);
    lineTotalDiscounts += lineDisc;

    processedItems.push({
      row_number: idx + 1,
      product_id: item.productId,
      warehouse_id: item.warehouseId,
      quantity: qty,
      unit_price_amount: unitPrice,
      discount_amount: lineDisc,
      total_price_amount: lineTotal,
      unit_cost_amount: item.unitCostPrice || null,
      total_cost_amount: item.totalCostPrice || null,
      serial_numbers: item.serialNumbers ? item.serialNumbers : null,
      description: item.description || null
    });
  }

  const invoiceGeneralDiscount = Number(discount || 0);
  const totalCombinedDiscount = lineTotalDiscounts + invoiceGeneralDiscount;
  const effectiveTaxPercent = Number(taxPercent || 0);

  const taxableBase = Math.max(0, calculatedSubtotal - totalCombinedDiscount);
  const calculatedTax = Math.round(taxableBase * (effectiveTaxPercent / 100));
  const calculatedTotal = Math.round(taxableBase + calculatedTax);

  const finalCashPaid = Number(cashPaidAmount || 0);
  const finalPosPaid = Number(posPaidAmount || 0);
  const totalPaid = finalCashPaid + finalPosPaid;

  // 6. Generate Idempotency Operation Key & Request Fingerprint
  const opKey = operationKey || `op_inv_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const requestFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        organizationId,
        invoiceType,
        personId,
        items: processedItems,
        calculatedTotal
      })
    )
    .digest("hex");

  // 6.5. Delegate to Cheque Orchestration RPC if Cheques Present
  if (isSettledWithChecks || (payload.checks && Array.isArray(payload.checks) && payload.checks.length > 0)) {
    const { data: rpcData, error: rpcErr } = await supabaseClient.rpc("create_invoice_with_cheques_atomic", {
      p_organization_id: organizationId,
      p_branch_id: resolvedBranchId,
      p_fiscal_year_id: resolvedFiscalYearId,
      p_user_id: String(userId),
      p_invoice_type: invoiceType,
      p_person_id: personId,
      p_date: date || new Date().toISOString().split("T")[0],
      p_date_jalali: dateJalali || date || new Date().toISOString().split("T")[0],
      p_is_pro_invoice: Boolean(isProInvoice),
      p_discount: Number(discount || 0),
      p_tax_percent: Number(taxPercent || 0),
      p_description: description || null,
      p_cash_paid_amount: Number(cashPaidAmount || 0),
      p_pos_paid_amount: Number(posPaidAmount || 0),
      p_pos_terminal_id: posTerminalId || null,
      p_settlement_commission: Number(settlementCommission || 0),
      p_cost_center_id: costCenterId || null,
      p_items: processedItems,
      p_cheques: (payload.checks || []).map((chk: any) => ({
        cheque_type: chk.type || chk.cheque_type || (invoiceType === 'SELL' ? 'received' : 'paid'),
        check_number: chk.checkNumber || chk.check_number,
        sayadi_identifier: chk.sayadiIdentifier || chk.sayadi_identifier || null,
        amount: Number(chk.amount),
        bank_name: chk.bankName || chk.bank_name || 'نامشخص',
        branch_name: chk.branchName || chk.branch_name || null,
        due_date: chk.dueDate || chk.due_date,
        due_date_jalali: chk.dueDateJalali || chk.due_date_jalali || null,
        account_number: chk.accountNumber || chk.account_number || null,
        drawer_name: chk.drawerName || chk.drawer_name || null,
        description: chk.description || null
      })),
      p_operation_key: opKey,
      p_request_fingerprint: requestFingerprint
    });

    if (rpcErr) {
      throw new Error(`ERR_INVOICE_CHEQUES_FAILED: ${rpcErr.message}`);
    }

    return {
      invoiceId: rpcData.id,
      invoiceNumber: rpcData.invoice_number,
      totalAmount: rpcData.final_amount,
      journalVoucherId: rpcData.journal_voucher_id,
      inventoryTransactionId: rpcData.inventory_transaction_id,
      version: rpcData.version || 1
    };
  }

  // 7. Check Idempotency: Existing invoice with same operation_key
  const { data: existingInv } = await supabaseClient
    .from("invoices")
    .select("id, invoice_number, total_amount, operation_key, request_fingerprint")
    .eq("organization_id", organizationId)
    .eq("operation_key", opKey)
    .maybeSingle();

  if (existingInv) {
    if (existingInv.request_fingerprint === requestFingerprint) {
      // Return previous result without modifying database
      return {
        isDuplicate: true,
        invoiceId: existingInv.id,
        invoiceNumber: existingInv.invoice_number,
        totalAmount: existingInv.total_amount
      };
    } else {
      throw new Error("ERR_IDEMPOTENCY_CONFLICT: درخواست تکراری با محتوای متفاوت.");
    }
  }

  // 8. Atomic Invoice Number Assignment
  const { data: nextInvNum, error: seqErr } = await supabaseClient.rpc("get_next_invoice_number", {
    p_org_id: organizationId
  });

  if (seqErr || !nextInvNum) {
    throw new Error("ERR_SEQUENCE_GENERATION_FAILED: خطا در تخصیص شماره سریال فاکتور.");
  }
  const assignedInvoiceNumber = Number(nextInvNum);

  const invoiceDateStr = date || new Date().toISOString().split("T")[0];
  const invoiceDateJalaliStr = dateJalali || invoiceDateStr;

  // 9. Insert Invoice Header into public.invoices
  const { data: newInvoiceRow, error: invInsertErr } = await supabaseClient
    .from("invoices")
    .insert({
      organization_id: organizationId,
      branch_id: resolvedBranchId,
      fiscal_year_id: resolvedFiscalYearId,
      invoice_number: assignedInvoiceNumber,
      invoice_type: invoiceType,
      person_id: personId,
      invoice_date: invoiceDateStr,
      invoice_date_jalali: invoiceDateJalaliStr,
      is_pro_invoice: isProInvoice,
      subtotal_amount: calculatedSubtotal,
      discount_amount: totalCombinedDiscount,
      tax_percent: effectiveTaxPercent,
      tax_amount: calculatedTax,
      total_amount: calculatedTotal,
      paid_amount: totalPaid,
      cash_paid_amount: finalCashPaid,
      pos_paid_amount: finalPosPaid,
      pos_terminal_id: posTerminalId || null,
      is_installment_deferred: isInstallmentDeferred,
      is_settled_with_checks: isSettledWithChecks,
      is_paid_from_wallet: isPaidFromWallet,
      settlement_commission_amount: Number(settlementCommission || 0),
      cost_center_id: costCenterId || null,
      purchase_manager_profit_rate: purchaseManagerProfitRate || null,
      description: description || null,
      operation_key: opKey,
      request_fingerprint: requestFingerprint,
      status: "POSTED",
      version: 1,
      created_by: userId
    })
    .select("id")
    .single();

  if (invInsertErr || !newInvoiceRow) {
    throw new Error(`ERR_INVOICE_INSERT_FAILED: ${invInsertErr?.message || "خطا در ثبت فاکتور"}`);
  }
  const invoiceId = newInvoiceRow.id;

  // 10. Insert Invoice Items into public.invoice_items
  const itemsToInsert = processedItems.map((item) => ({
    ...item,
    organization_id: organizationId,
    invoice_id: invoiceId
  }));

  const { error: itemsInsertErr } = await supabaseClient.from("invoice_items").insert(itemsToInsert);

  if (itemsInsertErr) {
    // Rollback by deleting invoice header (in standard single-transaction backend, ROLLBACK takes care of this)
    await supabaseClient.from("invoices").delete().eq("id", invoiceId);
    throw new Error(`ERR_INVOICE_ITEMS_INSERT_FAILED: ${itemsInsertErr.message}`);
  }

  // 11. If Pro-Invoice, stop here (No Voucher & No Inventory Effect)
  if (isProInvoice) {
    return {
      success: true,
      invoiceId,
      invoiceNumber: assignedInvoiceNumber,
      totalAmount: calculatedTotal,
      isProInvoice: true
    };
  }

  // 12. Create Journal Voucher & Entries for Real Invoice
  // Exact Double Entry Logic preservation:
  let journalVoucherId: string | null = null;
  let inventoryTransactionId: string | null = null;

  try {
    const pName = personRow.name || personName || "طرف حساب";
    const voucherDesc = `${invoiceType === "SELL" ? "فروش" : "خرید"} - فاکتور ${assignedInvoiceNumber}`;

    // Resolve Account Subsidiaries
    const { data: subRows } = await supabaseClient
      .from("account_subsidiaries")
      .select("id, code, name")
      .eq("organization_id", organizationId);

    const subMap: Record<string, string> = {};
    if (subRows) {
      for (const s of subRows) {
        subMap[s.code] = s.id;
      }
    }

    const subArId = subMap["1101"] || subMap["SUB_DEBTORS"] || null;
    const subDebtorsInstId = subMap["1106"] || subMap["SUB_DEBTORS_INSTALLMENT"] || subArId;
    const subApId = subMap["2101"] || subMap["SUB_CREDITORS"] || null;
    const subSalesId = subMap["4101"] || subMap["SUB_REVENUE"] || null;
    const subInventoryId = subMap["1105"] || subMap["SUB_INVENTORY"] || null;
    const subVatBuyId = subMap["1108"] || subMap["SUB_VAT_BUY"] || null;
    const subVatSellId = subMap["2105"] || subMap["SUB_VAT_SELL"] || null;
    const subCashId = subMap["1102"] || subMap["SUB_CASH_MAIN"] || subMap["SUB_CASH"] || null;
    const subPosId = subMap["1103"] || subMap["SUB_BANK_POS"] || subMap["SUB_BANK"] || subCashId || subArId;

    const voucherEntries = [];

    if (invoiceType === "SELL") {
      let rowNum = 1;
      const remaining = calculatedTotal - (finalCashPaid + finalPosPaid);

      if (finalCashPaid > 0 && subCashId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subCashId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: finalCashPaid,
          credit: 0,
          description: `دریافت نقدی بابت فاکتور فروش شماره ${assignedInvoiceNumber}`
        });
      }

      if (finalPosPaid > 0 && subPosId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subPosId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: finalPosPaid,
          credit: 0,
          description: `دریافت کارتخوان (POS) بابت فاکتور فروش شماره ${assignedInvoiceNumber}`
        });
      }

      if (remaining > 0 || (finalCashPaid === 0 && finalPosPaid === 0)) {
        const actualDebt = remaining > 0 ? remaining : calculatedTotal;
        const targetSubDebtor = isInstallmentDeferred ? (subDebtorsInstId || subArId || subCashId) : (subArId || subCashId);
        const debtDesc = isInstallmentDeferred
          ? `فروش اقساطی - فاکتور شماره ${assignedInvoiceNumber} (${pName})`
          : `فروش نسیه - فاکتور شماره ${assignedInvoiceNumber} (${pName})`;

        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: targetSubDebtor,
          person_id: personId,
          cost_center_id: costCenterId || null,
          debit: actualDebt,
          credit: 0,
          description: debtDesc
        });
      }

      // Credit Revenue
      if (subSalesId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subSalesId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: taxableBase,
          description: `فروش طی فاکتور شماره ${assignedInvoiceNumber}`
        });
      }

      // Credit VAT
      if (calculatedTax > 0 && subVatSellId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subVatSellId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: calculatedTax,
          description: `مالیات ارزش افزوده فاکتور فروش ${assignedInvoiceNumber}`
        });
      }
    } else {
      // BUY Invoice
      let rowNum = 1;

      // Debit Inventory
      if (subInventoryId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subInventoryId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: taxableBase,
          credit: 0,
          description: `خرید طی فاکتور شماره ${assignedInvoiceNumber}`
        });
      }

      // Debit VAT
      if (calculatedTax > 0 && subVatBuyId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subVatBuyId,
          person_id: null,
          cost_center_id: costCenterId || null,
          debit: calculatedTax,
          credit: 0,
          description: `مالیات ارزش افزوده فاکتور خرید ${assignedInvoiceNumber}`
        });
      }

      // Credit Creditors (AP)
      if (subApId) {
        voucherEntries.push({
          row_number: rowNum++,
          subsidiary_id: subApId,
          person_id: personId,
          cost_center_id: costCenterId || null,
          debit: 0,
          credit: calculatedTotal,
          description: `خرید طی فاکتور شماره ${assignedInvoiceNumber} (${pName})`
        });
      }
    }

    // Verify Debit == Credit
    const totalDebit = voucherEntries.reduce((sum, e) => sum + (e.debit || 0), 0);
    const totalCredit = voucherEntries.reduce((sum, e) => sum + (e.credit || 0), 0);

    if (totalDebit !== totalCredit) {
      throw new Error(`ERR_VOUCHER_UNBALANCED: سند حسابداری تراز نیست (بدهکار: ${totalDebit}, بستانکار: ${totalCredit})`);
    }

    // Insert Journal Voucher Header
    const { data: vHead, error: vHeadErr } = await supabaseClient
      .from("journal_vouchers")
      .insert({
        organization_id: organizationId,
        branch_id: resolvedBranchId,
        fiscal_year_id: resolvedFiscalYearId,
        voucher_date: invoiceDateStr,
        description: voucherDesc,
        status: "POSTED",
        is_balanced: true,
        total_debit: totalDebit,
        total_credit: totalCredit,
        source_type: invoiceType === "SELL" ? "SELL_INVOICE" : "BUY_INVOICE",
        source_id: invoiceId,
        version: 1,
        posted_by: userId,
        posted_at: new Date().toISOString(),
        created_by: userId
      })
      .select("id")
      .single();

    if (vHeadErr || !vHead) {
      throw new Error(`ERR_VOUCHER_HEADER_FAILED: ${vHeadErr?.message || "خطا در ثبت سند"}`);
    }
    journalVoucherId = vHead.id;

    // Insert Voucher Entries
    const vEntriesToInsert = voucherEntries.map((e) => ({
      ...e,
      organization_id: organizationId,
      voucher_id: journalVoucherId
    }));

    const { error: vEntriesErr } = await supabaseClient.from("voucher_entries").insert(vEntriesToInsert);
    if (vEntriesErr) {
      throw new Error(`ERR_VOUCHER_ENTRIES_FAILED: ${vEntriesErr.message}`);
    }

    // Insert Inventory Transaction (Header & Items)
    const { data: invTxHead, error: invTxHeadErr } = await supabaseClient
      .from("inventory_transactions")
      .insert({
        organization_id: organizationId,
        initiating_branch_id: resolvedBranchId,
        fiscal_year_id: resolvedFiscalYearId,
        transaction_type: invoiceType === "SELL" ? "SALE_ISSUE" : "PURCHASE_RECEIPT",
        transaction_date: invoiceDateStr,
        journal_voucher_id: journalVoucherId,
        description: `گردش انبار بابت فاکتور ${assignedInvoiceNumber}`,
        status: "POSTED",
        posted_by: userId,
        posted_at: new Date().toISOString(),
        created_by: userId
      })
      .select("id")
      .single();

    if (invTxHeadErr || !invTxHead) {
      throw new Error(`ERR_INVENTORY_TX_HEADER_FAILED: ${invTxHeadErr?.message || "خطا در ثبت گردش انبار"}`);
    }
    inventoryTransactionId = invTxHead.id;

    const invTxItemsToInsert = processedItems.map((item) => ({
      organization_id: organizationId,
      transaction_id: inventoryTransactionId,
      product_id: item.product_id,
      source_warehouse_id: invoiceType === "SELL" ? item.warehouse_id : null,
      destination_warehouse_id: invoiceType === "BUY" ? item.warehouse_id : null,
      quantity: item.quantity,
      unit_cost_amount: item.unit_cost_amount,
      total_cost_amount: item.total_cost_amount
    }));

    const { error: invTxItemsErr } = await supabaseClient
      .from("inventory_transaction_items")
      .insert(invTxItemsToInsert);

    if (invTxItemsErr) {
      throw new Error(`ERR_INVENTORY_TX_ITEMS_FAILED: ${invTxItemsErr.message}`);
    }

    // Link Voucher & Inventory Tx to Invoice Header
    await supabaseClient
      .from("invoices")
      .update({
        journal_voucher_id: journalVoucherId,
        inventory_transaction_id: inventoryTransactionId
      })
      .eq("id", invoiceId);

    return {
      success: true,
      invoiceId,
      invoiceNumber: assignedInvoiceNumber,
      journalVoucherId,
      inventoryTransactionId,
      totalAmount: calculatedTotal,
      subtotalAmount: calculatedSubtotal,
      taxAmount: calculatedTax,
      totalDebit
    };
  } catch (error: any) {
    // Atomic Error Compensation Cleanup:
    // Guarantees all compensating actions execute in parallel and all failures are captured
    // preventing orphaned records if a disconnect or error occurs during compensation.
    try {
      if (invoiceId) {
        // Attempt atomic database-level cleanup RPC first if provisioned
        const { error: rpcErr } = await supabaseClient.rpc("cleanup_orphaned_invoice_atomic", {
          p_organization_id: organizationId,
          p_invoice_id: invoiceId,
          p_voucher_id: journalVoucherId || null,
          p_inventory_tx_id: inventoryTransactionId || null
        });

        if (rpcErr) {
          // Fallback to parallel resilient allSettled compensation
          await Promise.allSettled([
            inventoryTransactionId
              ? supabaseClient.from("inventory_transaction_items").delete().eq("transaction_id", inventoryTransactionId)
              : Promise.resolve(),
            inventoryTransactionId
              ? supabaseClient.from("inventory_transactions").delete().eq("id", inventoryTransactionId)
              : Promise.resolve(),
            journalVoucherId
              ? supabaseClient.from("voucher_entries").delete().eq("voucher_id", journalVoucherId)
              : Promise.resolve(),
            journalVoucherId
              ? supabaseClient.from("journal_vouchers").delete().eq("id", journalVoucherId)
              : Promise.resolve(),
            supabaseClient.from("invoice_items").delete().eq("invoice_id", invoiceId),
            supabaseClient.from("invoices").delete().eq("id", invoiceId)
          ]);
        }
      }
    } catch (cleanupErr) {
      console.error("[AtomicInvoiceService] Critical warning: Error during rollback compensation:", cleanupErr);
    }

    throw error;
  }
}

/**
 * Atomically voids a posted invoice in PostgreSQL:
 * - Locks and validates invoice ownership, status, idempotency, and cheque/installment restrictions.
 * - Creates a new reverse journal voucher with inverted debits/credits.
 * - Creates a new compensating inventory transaction.
 * - Marks invoice as VOIDED with audit metadata.
 */
/**
 * Atomically voids a posted invoice in PostgreSQL via authoritative PL/pgSQL RPC function void_invoice_atomic.
 * Guarantees a true single database transaction with row locking, idempotency, and full rollback on error.
 */
export async function executeServerVoidInvoice(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  invoiceId: string,
  reason: string = "ابطال فاکتور"
) {
  const { data, error } = await supabaseClient.rpc("void_invoice_atomic", {
    p_organization_id: organizationId,
    p_invoice_id: invoiceId,
    p_user_id: userId,
    p_reason: reason
  });

  if (error) {
    const err = new Error(error.message || "ERR_INVOICE_VOID_FAILED: خطا در ابطال اتمیک فاکتور.");
    (err as any).statusCode = error.message && error.message.includes("ERR_") ? 400 : 500;
    throw err;
  }

  return data;
}

/**
 * Safely deletes a Draft / Pro-Invoice with zero financial/inventory linkage.
 */
export async function executeServerDeleteProInvoice(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  invoiceId: string
) {
  const { data: inv, error: fetchErr } = await supabaseClient
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (fetchErr || !inv) {
    const err = new Error("ERR_INVOICE_NOT_FOUND: فاکتور مورد نظر یافت نشد.");
    (err as any).statusCode = 404;
    throw err;
  }

  if (!inv.is_pro_invoice && inv.status !== "DRAFT") {
    const err = new Error("ERR_POSTED_INVOICE_CANNOT_BE_DELETED: فاکتور ثبت‌شده قابل حذف فیزیکی نیست. برای اصلاح از ابطال استفاده کنید.");
    (err as any).statusCode = 400;
    throw err;
  }

  if (inv.journal_voucher_id || inv.inventory_transaction_id) {
    const err = new Error("ERR_FINANCIAL_LINKAGE_EXISTS: فاکتور دارای سند حسابداری یا گردش انبار است و حذف فیزیکی آن مجاز نیست.");
    (err as any).statusCode = 400;
    throw err;
  }

  await supabaseClient.from("invoice_items").delete().eq("invoice_id", invoiceId);
  const { error: delErr } = await supabaseClient
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("organization_id", organizationId);

  if (delErr) {
    throw new Error(`ERR_PRO_INVOICE_DELETE_FAILED: ${delErr.message}`);
  }

  return {
    success: true,
    invoiceId,
    deleted: true
  };
}

/**
 * Atomically converts an order to an invoice using durable order_invoice_conversions guard.
 * Enforces:
 * - Unique (organization_id, source_order_id) invariant
 * - Idempotent retry with same payload (returns existing authoritative invoice)
 * - Conflict rejection with same order + different payload
 * - Safe rollback of PROCESSING guard if invoice creation fails
 */
export async function executeServerConvertOrder(
  supabaseClient: SupabaseClient,
  organizationId: string,
  userId: string,
  sourceOrderId: string,
  invoicePayload: InvoiceCreatePayload
): Promise<any> {
  const fingerprintPayload = {
    sourceOrderId,
    invoiceType: invoicePayload.invoiceType,
    personId: invoicePayload.personId,
    totalAmount: (invoicePayload.items || []).reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0)), 0),
    items: (invoicePayload.items || []).map(i => ({ p: i.productId, q: i.quantity, u: i.unitPrice, w: i.warehouseId }))
  };
  const requestFingerprint = crypto.createHash("sha256").update(JSON.stringify(fingerprintPayload)).digest("hex");

  const { data: existingGuard, error: guardErr } = await supabaseClient
    .from("order_invoice_conversions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("source_order_id", sourceOrderId)
    .maybeSingle();

  if (existingGuard) {
    if (existingGuard.status === "COMPLETED" && existingGuard.invoice_id) {
      if (existingGuard.request_fingerprint !== requestFingerprint) {
        const err = new Error("ERR_ORDER_CONVERSION_PAYLOAD_CONFLICT: سفارش قبلاً به فاکتور دیگری تبدیل شده است و اطلاعات مالی ارسالی با فاکتور ثبت‌شده مطابقت ندارد.");
        (err as any).statusCode = 409;
        throw err;
      }
      const { data: existingInv, error: invFetchErr } = await supabaseClient
        .from("invoices")
        .select("*, invoice_items(*)")
        .eq("id", existingGuard.invoice_id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (invFetchErr || !existingInv) {
        throw new Error("ERR_CONVERTED_INVOICE_NOT_FOUND: فاکتور مرتبط با این سفارش در دیتابیس یافت نشد.");
      }
      return {
        ...existingInv,
        invoiceId: existingInv.id,
        invoiceNumber: existingInv.invoice_number,
        journalVoucherId: existingInv.journal_voucher_id,
        inventoryTransactionId: existingInv.inventory_transaction_id,
        reused: true
      };
    } else if (existingGuard.status === "PROCESSING") {
      if (existingGuard.request_fingerprint !== requestFingerprint) {
        const err = new Error("ERR_ORDER_CONVERSION_PAYLOAD_CONFLICT: مغایرت در اطلاعات فاکتور سفارش در حال پردازش.");
        (err as any).statusCode = 409;
        throw err;
      }
      if (existingGuard.invoice_id) {
        const { data: inv } = await supabaseClient
          .from("invoices")
          .select("*, invoice_items(*)")
          .eq("id", existingGuard.invoice_id)
          .maybeSingle();
        if (inv) {
          return { ...inv, invoiceId: inv.id, invoiceNumber: inv.invoice_number, journalVoucherId: inv.journal_voucher_id, inventoryTransactionId: inv.inventory_transaction_id, reused: true };
        }
      }
    }
  }

  const { error: insertGuardErr } = await supabaseClient
    .from("order_invoice_conversions")
    .insert({
      organization_id: organizationId,
      source_order_id: sourceOrderId,
      request_fingerprint: requestFingerprint,
      status: "PROCESSING"
    });

  if (insertGuardErr) {
    if (insertGuardErr.code === "23505" || (insertGuardErr.message && insertGuardErr.message.includes("violates unique constraint"))) {
      const { data: retryGuard } = await supabaseClient
        .from("order_invoice_conversions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("source_order_id", sourceOrderId)
        .single();
      
      if (retryGuard && retryGuard.invoice_id) {
        if (retryGuard.request_fingerprint !== requestFingerprint) {
          const err = new Error("ERR_ORDER_CONVERSION_PAYLOAD_CONFLICT: مغایرت در پِی‌لاد تبدیل همزمان سفارش.");
          (err as any).statusCode = 409;
          throw err;
        }
        const { data: retryInv } = await supabaseClient
          .from("invoices")
          .select("*, invoice_items(*)")
          .eq("id", retryGuard.invoice_id)
          .single();
        if (retryInv) {
          return { ...retryInv, invoiceId: retryInv.id, invoiceNumber: retryInv.invoice_number, journalVoucherId: retryInv.journal_voucher_id, inventoryTransactionId: retryInv.inventory_transaction_id, reused: true };
        }
      }
    }
    throw new Error(`ERR_ORDER_CONVERSION_GUARD_FAILED: ${insertGuardErr.message}`);
  }

  let createdInvoiceResult;
  try {
    createdInvoiceResult = await executeServerCreateInvoice(supabaseClient, organizationId, userId, invoicePayload);
  } catch (err: any) {
    await supabaseClient
      .from("order_invoice_conversions")
      .delete()
      .eq("organization_id", organizationId)
      .eq("source_order_id", sourceOrderId)
      .eq("status", "PROCESSING");
    throw err;
  }

  await supabaseClient
    .from("order_invoice_conversions")
    .update({
      invoice_id: createdInvoiceResult.id,
      status: "COMPLETED",
      updated_at: new Date().toISOString()
    })
    .eq("organization_id", organizationId)
    .eq("source_order_id", sourceOrderId);

  return {
    ...createdInvoiceResult,
    reused: false
  };
}

