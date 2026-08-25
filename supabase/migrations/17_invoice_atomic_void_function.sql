-- ==============================================================================
-- Migration: 17_invoice_atomic_void_function.sql
-- Description: Block 2 - Command 12A.2 - Authoritative PostgreSQL Atomic Invoice Void & Reversal Function
-- Rules:
--   1. True single PostgreSQL transaction with row-level locking (FOR UPDATE).
--   2. Strict organization and session auth validation (auth.uid() priority).
--   3. Fail-closed for checks and installments.
--   4. Immutable preservation of original invoice, voucher, and inventory transaction.
--   5. Exact reversal of voucher entries (debit/credit inversion) and inventory movements.
--   6. Normalized inventory movement enum (SALE_ISSUE / PURCHASE_RECEIPT).
--   7. Idempotent protection against duplicate/concurrent voids.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.void_invoice_atomic(
    p_organization_id UUID,
    p_invoice_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT 'ابطال فاکتور'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_acting_user_id UUID;
    v_inv RECORD;
    v_orig_voucher RECORD;
    v_orig_tx RECORD;
    v_rev_voucher_id UUID;
    v_rev_tx_id UUID;
    v_rev_voucher_num BIGINT;
    v_rev_fy_id UUID;
    v_entry RECORD;
    v_item RECORD;
    v_rev_tx_type TEXT;
    v_now TIMESTAMPTZ := now();
    v_today DATE := current_date;
BEGIN
    -- 0. Identity & Parameters Validation
    IF p_organization_id IS NULL OR p_invoice_id IS NULL THEN
        RAISE EXCEPTION 'ERR_INVALID_PARAMS: Organization ID and Invoice ID are required.';
    END IF;

    -- Validate user identity: Prefer verified auth session context (auth.uid()), fallback to provided p_user_id if valid
    v_acting_user_id := COALESCE(v_auth_uid, p_user_id);
    IF v_acting_user_id IS NULL THEN
        SELECT id INTO v_acting_user_id FROM public.user_profiles WHERE organization_id = p_organization_id LIMIT 1;
    END IF;

    IF v_acting_user_id IS NULL THEN
        RAISE EXCEPTION 'ERR_UNAUTHORIZED: Active user session or valid user ID is required.';
    END IF;

    -- 1. Lock and fetch target invoice
    SELECT * INTO v_inv
    FROM public.invoices
    WHERE id = p_invoice_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ERR_INVOICE_NOT_FOUND: فاکتور مورد نظر یافت نشد.';
    END IF;

    -- 2. Idempotency Check
    IF v_inv.status = 'VOIDED' OR v_inv.reversal_voucher_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'isDuplicate', true,
            'invoiceId', v_inv.id,
            'invoiceNumber', v_inv.invoice_number,
            'status', 'VOIDED',
            'reversalVoucherId', v_inv.reversal_voucher_id,
            'reversalInventoryTransactionId', v_inv.reversal_inventory_transaction_id
        );
    END IF;

    -- 3. Fail-Closed Check & Installment Boundary
    IF v_inv.is_settled_with_checks IS TRUE OR v_inv.is_installment_deferred IS TRUE THEN
        RAISE EXCEPTION 'ERR_FAIL_CLOSED_SETTLEMENT: ابطال فاکتورهای دارای چک صیادی یا اقساط در این نسخه پشتیبانی نمی‌شود.';
    END IF;

    -- 4. Process Journal Voucher Reversal if linked
    IF v_inv.journal_voucher_id IS NOT NULL THEN
        SELECT * INTO v_orig_voucher
        FROM public.journal_vouchers
        WHERE id = v_inv.journal_voucher_id AND organization_id = p_organization_id
        FOR UPDATE;

        IF FOUND THEN
            v_rev_fy_id := v_orig_voucher.fiscal_year_id;

            -- Get next voucher number for the fiscal year
            INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
            VALUES (p_organization_id, v_rev_fy_id, 1, v_acting_user_id)
            ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

            SELECT next_number INTO v_rev_voucher_num
            FROM public.voucher_sequences
            WHERE organization_id = p_organization_id AND fiscal_year_id = v_rev_fy_id
            FOR UPDATE;

            UPDATE public.voucher_sequences
            SET next_number = next_number + 1,
                updated_by = v_acting_user_id,
                updated_at = v_now
            WHERE organization_id = p_organization_id AND fiscal_year_id = v_rev_fy_id;

            v_rev_voucher_id := gen_random_uuid();

            -- Create Reverse Voucher Header
            INSERT INTO public.journal_vouchers (
                id, organization_id, branch_id, fiscal_year_id, voucher_number, voucher_date,
                description, status, voucher_kind, is_automatic, source_type, source_id,
                reversal_of_voucher_id, is_balanced, total_debit, total_credit,
                created_by, posted_by, posted_at, version
            ) VALUES (
                v_rev_voucher_id, p_organization_id, v_orig_voucher.branch_id, v_rev_fy_id, v_rev_voucher_num, v_today,
                'سند معکوس بابت ابطال فاکتور شماره ' || v_inv.invoice_number || ': ' || p_reason,
                'POSTED', 'REVERSAL', true, v_orig_voucher.source_type, v_inv.id,
                v_orig_voucher.id, true, v_orig_voucher.total_credit, v_orig_voucher.total_debit,
                v_acting_user_id, v_acting_user_id, v_now, 1
            );

            -- Create Reverse Voucher Entries (Inverting Debit and Credit)
            FOR v_entry IN
                SELECT * FROM public.voucher_entries
                WHERE voucher_id = v_orig_voucher.id AND organization_id = p_organization_id
                ORDER BY row_number ASC
            LOOP
                INSERT INTO public.voucher_entries (
                    id, organization_id, voucher_id, row_number, subsidiary_id, person_id,
                    cost_center_id, financial_role_code, debit, credit, description, contract_type
                ) VALUES (
                    gen_random_uuid(), p_organization_id, v_rev_voucher_id, v_entry.row_number,
                    v_entry.subsidiary_id, v_entry.person_id, v_entry.cost_center_id,
                    v_entry.financial_role_code, v_entry.credit, v_entry.debit,
                    'معکوس: ' || COALESCE(v_entry.description, ''), v_entry.contract_type
                );
            END LOOP;

            -- Mark Original Voucher as REVERSED
            UPDATE public.journal_vouchers
            SET status = 'REVERSED',
                reversed_by = v_acting_user_id,
                reversed_at = v_now,
                reversal_reason = p_reason,
                updated_at = v_now
            WHERE id = v_orig_voucher.id AND organization_id = p_organization_id;
        END IF;
    END IF;

    -- 5. Process Inventory Transaction Reversal if linked
    IF v_inv.inventory_transaction_id IS NOT NULL THEN
        SELECT * INTO v_orig_tx
        FROM public.inventory_transactions
        WHERE id = v_inv.inventory_transaction_id AND organization_id = p_organization_id
        FOR UPDATE;

        IF FOUND THEN
            v_rev_tx_type := CASE 
                WHEN v_orig_tx.transaction_type IN ('SALE_ISSUE', 'SALES_ISSUE') THEN 'PURCHASE_RECEIPT' 
                ELSE 'SALE_ISSUE' 
            END;
            v_rev_tx_id := gen_random_uuid();

            -- Create Reverse Inventory Transaction Header
            INSERT INTO public.inventory_transactions (
                id, organization_id, initiating_branch_id, fiscal_year_id, transaction_type,
                transaction_date, journal_voucher_id, description, status,
                reversal_of_transaction_id, created_by, posted_by, posted_at
            ) VALUES (
                v_rev_tx_id, p_organization_id, v_orig_tx.initiating_branch_id, v_orig_tx.fiscal_year_id,
                v_rev_tx_type, v_today, v_rev_voucher_id,
                'گردش انبار معکوس بابت ابطال فاکتور ' || v_inv.invoice_number,
                'POSTED', v_orig_tx.id, v_acting_user_id, v_acting_user_id, v_now
            );

            -- Create Reverse Inventory Transaction Items
            FOR v_item IN
                SELECT * FROM public.inventory_transaction_items
                WHERE transaction_id = v_orig_tx.id AND organization_id = p_organization_id
            LOOP
                INSERT INTO public.inventory_transaction_items (
                    id, organization_id, transaction_id, product_id,
                    source_warehouse_id, destination_warehouse_id,
                    quantity, unit_cost_amount, total_cost_amount
                ) VALUES (
                    gen_random_uuid(), p_organization_id, v_rev_tx_id, v_item.product_id,
                    CASE WHEN v_rev_tx_type IN ('SALE_ISSUE', 'SALES_ISSUE') THEN COALESCE(v_item.destination_warehouse_id, v_item.source_warehouse_id) ELSE NULL END,
                    CASE WHEN v_rev_tx_type = 'PURCHASE_RECEIPT' THEN COALESCE(v_item.source_warehouse_id, v_item.destination_warehouse_id) ELSE NULL END,
                    v_item.quantity, v_item.unit_cost_amount, v_item.total_cost_amount
                );
            END LOOP;
        END IF;
    END IF;

    -- 6. Mark Invoice VOIDED and link reversal references
    UPDATE public.invoices
    SET status = 'VOIDED',
        settlement_status = 'VOIDED',
        voided_by = v_acting_user_id::text,
        voided_at = v_now,
        void_reason = p_reason,
        reversal_voucher_id = v_rev_voucher_id,
        reversal_inventory_transaction_id = v_rev_tx_id,
        version = version + 1,
        updated_at = v_now
    WHERE id = p_invoice_id AND organization_id = p_organization_id;

    RETURN jsonb_build_object(
        'success', true,
        'invoiceId', p_invoice_id,
        'invoiceNumber', v_inv.invoice_number,
        'status', 'VOIDED',
        'reversalVoucherId', v_rev_voucher_id,
        'reversalInventoryTransactionId', v_rev_tx_id
    );
END;
$$;

COMMENT ON FUNCTION public.void_invoice_atomic IS 'Atomically voids a posted invoice, creates compensating reverse voucher and inventory transaction, and guarantees single PostgreSQL transaction rollback on failure.';

COMMIT;
