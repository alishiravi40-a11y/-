-- Migration 30: Atomic Warehouse Transfer & Accounting Journal Voucher Integration
-- Implements Command 5 - Server-authoritative atomic warehouse transfers,
-- warehouse inventory account mappings, and double-entry journal vouchers.

BEGIN;

-- ==============================================================================
-- 1. RPC: Get Warehouse Account Mappings
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_account_mappings(
    p_organization_id UUID,
    p_warehouse_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'organizationId', m.organization_id,
            'warehouseId', m.warehouse_id,
            'warehouseName', w.name,
            'subsidiaryId', m.subsidiary_id,
            'subsidiaryCode', s.code,
            'subsidiaryName', s.name,
            'effectiveFrom', m.effective_from,
            'effectiveTo', m.effective_to,
            'status', m.status,
            'changeReason', m.change_reason,
            'createdAt', m.created_at
        ) ORDER BY m.created_at DESC
    ), '[]'::jsonb) INTO v_result
    FROM public.warehouse_inventory_account_mappings m
    JOIN public.warehouses w ON w.id = m.warehouse_id AND w.organization_id = m.organization_id
    JOIN public.account_subsidiaries s ON s.id = m.subsidiary_id AND s.organization_id = m.organization_id
    WHERE m.organization_id = p_organization_id
      AND (p_warehouse_id IS NULL OR m.warehouse_id = p_warehouse_id);

    RETURN v_result;
END;
$$;

-- ==============================================================================
-- 2. RPC: Set Warehouse Account Mapping
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_set_warehouse_account_mapping(
    p_organization_id UUID,
    p_warehouse_id UUID,
    p_subsidiary_id UUID,
    p_change_reason TEXT,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wh_exists BOOLEAN;
    v_sub_exists BOOLEAN;
    v_new_id UUID;
    v_now TIMESTAMPTZ := now();
    v_result JSONB;
BEGIN
    -- Check warehouse belongs to org
    SELECT EXISTS(
        SELECT 1 FROM public.warehouses 
        WHERE id = p_warehouse_id AND organization_id = p_organization_id
    ) INTO v_wh_exists;

    IF NOT v_wh_exists THEN
        RAISE EXCEPTION 'Warehouse % not found in organization %.', p_warehouse_id, p_organization_id;
    END IF;

    -- Check subsidiary account belongs to org
    SELECT EXISTS(
        SELECT 1 FROM public.account_subsidiaries 
        WHERE id = p_subsidiary_id AND organization_id = p_organization_id
    ) INTO v_sub_exists;

    IF NOT v_sub_exists THEN
        RAISE EXCEPTION 'Account subsidiary % not found in organization %.', p_subsidiary_id, p_organization_id;
    END IF;

    -- Expire current active mapping for this warehouse
    UPDATE public.warehouse_inventory_account_mappings
    SET effective_to = v_now,
        status = 'EXPIRED',
        updated_at = v_now
    WHERE organization_id = p_organization_id
      AND warehouse_id = p_warehouse_id
      AND status = 'CURRENT';

    -- Insert new CURRENT mapping
    INSERT INTO public.warehouse_inventory_account_mappings (
        organization_id,
        warehouse_id,
        subsidiary_id,
        effective_from,
        effective_to,
        status,
        change_reason,
        created_by,
        created_at,
        updated_at
    ) VALUES (
        p_organization_id,
        p_warehouse_id,
        p_subsidiary_id,
        v_now,
        NULL,
        'CURRENT',
        p_change_reason,
        p_user_id,
        v_now,
        v_now
    ) RETURNING id INTO v_new_id;

    SELECT jsonb_build_object(
        'id', m.id,
        'organizationId', m.organization_id,
        'warehouseId', m.warehouse_id,
        'subsidiaryId', m.subsidiary_id,
        'effectiveFrom', m.effective_from,
        'status', m.status,
        'changeReason', m.change_reason
    ) INTO v_result
    FROM public.warehouse_inventory_account_mappings m
    WHERE m.id = v_new_id;

    RETURN v_result;
END;
$$;

-- ==============================================================================
-- 3. RPC: Execute Warehouse Transfer Atomic
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_execute_warehouse_transfer_atomic(
    p_organization_id UUID,
    p_user_id UUID,
    p_source_warehouse_id UUID,
    p_destination_warehouse_id UUID,
    p_transfer_date DATE,
    p_description TEXT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fiscal_year_id UUID;
    v_initiating_branch_id UUID;
    v_source_status TEXT;
    v_dest_status TEXT;
    v_source_sub_id UUID;
    v_dest_sub_id UUID;
    v_doc_no BIGINT;
    v_voucher_no BIGINT;
    v_tx_id UUID;
    v_jv_id UUID;
    v_total_transfer_cost BIGINT := 0;
    v_existing_tx RECORD;
    v_item RECORD;
    v_product_id UUID;
    v_item_qty NUMERIC(18, 3);
    v_is_serialized BOOLEAN;
    v_source_bal NUMERIC(18, 3);
    v_wac BIGINT;
    v_inv_val BIGINT;
    v_org_qty NUMERIC(18, 3);
    v_unit_cost BIGINT;
    v_line_cost BIGINT;
    v_tx_item_id UUID;
    v_serials JSONB;
    v_serial_str TEXT;
    v_serial_id UUID;
    v_idx INT;
    v_items_sorted JSONB;
BEGIN
    -- 1. Validate distinct source and destination warehouses
    IF p_source_warehouse_id = p_destination_warehouse_id THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_ACCOUNTS_NOT_DISTINCT';
    END IF;

    -- 2. Validate source warehouse active
    SELECT status, branch_id INTO v_source_status, v_initiating_branch_id
    FROM public.warehouses
    WHERE id = p_source_warehouse_id AND organization_id = p_organization_id;

    IF v_source_status IS NULL OR v_source_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Source warehouse % is not active or does not exist.', p_source_warehouse_id;
    END IF;

    -- 3. Validate destination warehouse active
    SELECT status INTO v_dest_status
    FROM public.warehouses
    WHERE id = p_destination_warehouse_id AND organization_id = p_organization_id;

    IF v_dest_status IS NULL OR v_dest_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Destination warehouse % is not active or does not exist.', p_destination_warehouse_id;
    END IF;

    -- 4. Get current fiscal year
    SELECT id INTO v_fiscal_year_id
    FROM public.fiscal_years
    WHERE organization_id = p_organization_id
      AND start_date <= p_transfer_date
      AND end_date >= p_transfer_date
      AND status = 'OPEN'
    LIMIT 1;

    IF v_fiscal_year_id IS NULL THEN
        -- Fallback to any open fiscal year for organization
        SELECT id INTO v_fiscal_year_id
        FROM public.fiscal_years
        WHERE organization_id = p_organization_id AND status = 'OPEN'
        ORDER BY start_date DESC LIMIT 1;
    END IF;

    IF v_fiscal_year_id IS NULL THEN
        RAISE EXCEPTION 'No open fiscal year found for organization % and date %.', p_organization_id, p_transfer_date;
    END IF;

    -- 5. Extract valid account mappings for source and destination warehouses
    SELECT subsidiary_id INTO v_source_sub_id
    FROM public.warehouse_inventory_account_mappings
    WHERE organization_id = p_organization_id
      AND warehouse_id = p_source_warehouse_id
      AND status = 'CURRENT'
    ORDER BY effective_from DESC LIMIT 1;

    SELECT subsidiary_id INTO v_dest_sub_id
    FROM public.warehouse_inventory_account_mappings
    WHERE organization_id = p_organization_id
      AND warehouse_id = p_destination_warehouse_id
      AND status = 'CURRENT'
    ORDER BY effective_from DESC LIMIT 1;

    IF v_source_sub_id IS NULL OR v_dest_sub_id IS NULL THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_ACCOUNT_MAPPING_REQUIRED';
    END IF;

    IF v_source_sub_id = v_dest_sub_id THEN
        RAISE EXCEPTION 'ERR_WAREHOUSE_ACCOUNTS_NOT_DISTINCT';
    END IF;

    -- 6. Idempotency Check
    SELECT id, document_number, journal_voucher_id, request_fingerprint, status
    INTO v_existing_tx
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND transaction_type = 'TRANSFER'
      AND idempotency_key = p_operation_key;

    IF v_existing_tx.id IS NOT NULL THEN
        IF v_existing_tx.request_fingerprint = p_request_fingerprint THEN
            RETURN jsonb_build_object(
                'transactionId', v_existing_tx.id,
                'documentNumber', v_existing_tx.document_number,
                'journalVoucherId', v_existing_tx.journal_voucher_id,
                'status', v_existing_tx.status,
                'isReplay', true
            );
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: operation_key % already used with a different request fingerprint.', p_operation_key;
        END IF;
    END IF;

    -- 7. Parse & Validate Items (Sort by product_id for deterministic row locking)
    SELECT jsonb_agg(elem ORDER BY elem->>'productId') INTO v_items_sorted
    FROM jsonb_array_elements(p_items) elem;

    IF v_items_sorted IS NULL OR jsonb_array_length(v_items_sorted) = 0 THEN
        RAISE EXCEPTION 'Transfer must contain at least one item.';
    END IF;

    -- Pre-screen items and check stock & costs
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_sorted) LOOP
        v_product_id := (v_item.value->>'productId')::UUID;
        v_item_qty := (v_item.value->>'quantity')::NUMERIC(18, 3);
        v_serials := v_item.value->'serialNumbers';

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'Transfer item quantity must be greater than zero.';
        END IF;

        -- Check serialized product
        SELECT is_serialized INTO v_is_serialized
        FROM public.products
        WHERE id = v_product_id AND organization_id = p_organization_id;

        IF v_is_serialized IS NULL THEN
            RAISE EXCEPTION 'Product % not found in organization %.', v_product_id, p_organization_id;
        END IF;

        -- Lock source warehouse balance
        SELECT quantity_on_hand INTO v_source_bal
        FROM public.inventory_balances
        WHERE organization_id = p_organization_id
          AND warehouse_id = p_source_warehouse_id
          AND product_id = v_product_id
        FOR UPDATE;

        IF v_source_bal IS NULL OR v_source_bal < v_item_qty THEN
            RAISE EXCEPTION 'Insufficient stock in source warehouse for product %. Current: %, Requested: %', 
                v_product_id, COALESCE(v_source_bal, 0), v_item_qty;
        END IF;

        -- Lock org cost balance & determine unit cost
        SELECT weighted_average_cost_amount, inventory_value_amount, organization_quantity_on_hand
        INTO v_wac, v_inv_val, v_org_qty
        FROM public.inventory_cost_balances
        WHERE organization_id = p_organization_id
          AND product_id = v_product_id
        FOR UPDATE;

        v_unit_cost := COALESCE(v_wac, 0);
        IF v_unit_cost <= 0 AND COALESCE(v_inv_val, 0) > 0 AND COALESCE(v_org_qty, 0) > 0 THEN
            v_unit_cost := ROUND(v_inv_val / v_org_qty);
        END IF;

        IF v_unit_cost <= 0 AND v_item_qty > 0 THEN
            RAISE EXCEPTION 'ERR_INVENTORY_COST_UNAVAILABLE';
        END IF;

        v_line_cost := ROUND(v_item_qty * v_unit_cost);
        v_total_transfer_cost := v_total_transfer_cost + v_line_cost;

        -- Serial validation
        IF v_is_serialized THEN
            IF v_serials IS NULL OR jsonb_array_length(v_serials) <> v_item_qty THEN
                RAISE EXCEPTION 'ERR_SERIAL_COUNT_MISMATCH: Serialized product % requires exactly % serial numbers.', v_product_id, v_item_qty;
            END IF;

            FOR v_idx IN 0..(jsonb_array_length(v_serials) - 1) LOOP
                v_serial_str := jsonb_array_element_text(v_serials, v_idx);
                SELECT id INTO v_serial_id
                FROM public.product_serials
                WHERE organization_id = p_organization_id
                  AND product_id = v_product_id
                  AND (serial_number_raw = v_serial_str OR serial_number_normalized = UPPER(TRIM(v_serial_str)) OR id::text = v_serial_str)
                  AND current_warehouse_id = p_source_warehouse_id
                  AND status = 'AVAILABLE'
                FOR UPDATE;

                IF v_serial_id IS NULL THEN
                    RAISE EXCEPTION 'ERR_INVALID_SERIAL: Serial % is not available in source warehouse.', v_serial_str;
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    -- 8. Allocate atomic document number from inventory_document_sequences
    INSERT INTO public.inventory_document_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_fiscal_year_id, 1, p_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_doc_no
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1, updated_at = now(), updated_by = p_user_id
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id;

    -- 9. Allocate atomic journal voucher number from voucher_sequences
    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_fiscal_year_id, 1, p_user_id)
    ON CONFLICT (organization_id, fiscal_year_id) DO NOTHING;

    SELECT next_number INTO v_voucher_no
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1, updated_at = now(), updated_by = p_user_id
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_fiscal_year_id;

    -- 10. Create Journal Voucher
    INSERT INTO public.journal_vouchers (
        organization_id,
        fiscal_year_id,
        voucher_number,
        voucher_date,
        voucher_type,
        status,
        description,
        created_by,
        posted_by,
        posted_at
    ) VALUES (
        p_organization_id,
        v_fiscal_year_id,
        v_voucher_no,
        p_transfer_date,
        'TRANSFER',
        'POSTED',
        COALESCE(p_description, 'سند انتقال بین انبار - شماره ' || v_doc_no),
        p_user_id,
        p_user_id,
        now()
    ) RETURNING id INTO v_jv_id;

    -- Debit destination warehouse inventory subsidiary account
    INSERT INTO public.voucher_entries (journal_voucher_id, row_number, subsidiary_id, debit, credit, description)
    VALUES (v_jv_id, 1, v_dest_sub_id, v_total_transfer_cost, 0, 'بدهکار - موجودی انبار مقصد (انتقال شماره ' || v_doc_no || ')');

    -- Credit source warehouse inventory subsidiary account
    INSERT INTO public.voucher_entries (journal_voucher_id, row_number, subsidiary_id, debit, credit, description)
    VALUES (v_jv_id, 2, v_source_sub_id, 0, v_total_transfer_cost, 'بستانکار - موجودی انبار مبدأ (انتقال شماره ' || v_doc_no || ')');

    -- 11. Create Inventory Transaction Header
    INSERT INTO public.inventory_transactions (
        organization_id,
        fiscal_year_id,
        initiating_branch_id,
        document_number,
        transaction_date,
        transaction_type,
        transaction_kind,
        status,
        description,
        idempotency_key,
        request_fingerprint,
        journal_voucher_id,
        created_by,
        posted_by,
        posted_at
    ) VALUES (
        p_organization_id,
        v_fiscal_year_id,
        v_initiating_branch_id,
        v_doc_no,
        p_transfer_date,
        'TRANSFER',
        'GENERAL',
        'POSTED',
        COALESCE(p_description, 'انتقال بین انبار'),
        p_operation_key,
        p_request_fingerprint,
        v_jv_id,
        p_user_id,
        p_user_id,
        now()
    ) RETURNING id INTO v_tx_id;

    -- 12. Create Items & Update Balances
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_sorted) LOOP
        v_product_id := (v_item.value->>'productId')::UUID;
        v_item_qty := (v_item.value->>'quantity')::NUMERIC(18, 3);
        v_serials := v_item.value->'serialNumbers';

        SELECT weighted_average_cost_amount INTO v_unit_cost
        FROM public.inventory_cost_balances
        WHERE organization_id = p_organization_id AND product_id = v_product_id;

        v_unit_cost := COALESCE(v_unit_cost, 0);
        v_line_cost := ROUND(v_item_qty * v_unit_cost);

        -- Insert item row
        INSERT INTO public.inventory_transaction_items (
            organization_id,
            transaction_id,
            product_id,
            source_warehouse_id,
            destination_warehouse_id,
            quantity,
            unit_cost_amount,
            total_cost_amount,
            created_at
        ) VALUES (
            p_organization_id,
            v_tx_id,
            v_product_id,
            p_source_warehouse_id,
            p_destination_warehouse_id,
            v_item_qty,
            v_unit_cost,
            v_line_cost,
            now()
        ) RETURNING id INTO v_tx_item_id;

        -- Decrease source warehouse balance
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item_qty,
            updated_at = now()
        WHERE organization_id = p_organization_id
          AND warehouse_id = p_source_warehouse_id
          AND product_id = v_product_id;

        -- Increase destination warehouse balance
        INSERT INTO public.inventory_balances (organization_id, warehouse_id, product_id, quantity_on_hand, updated_at)
        VALUES (p_organization_id, p_destination_warehouse_id, v_product_id, v_item_qty, now())
        ON CONFLICT (organization_id, warehouse_id, product_id)
        DO UPDATE SET quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                      updated_at = now();

        -- Handle serials if applicable
        SELECT is_serialized INTO v_is_serialized FROM public.products WHERE id = v_product_id AND organization_id = p_organization_id;
        IF v_is_serialized AND v_serials IS NOT NULL THEN
            FOR v_idx IN 0..(jsonb_array_length(v_serials) - 1) LOOP
                v_serial_str := jsonb_array_element_text(v_serials, v_idx);

                -- Update serial warehouse
                UPDATE public.product_serials
                SET current_warehouse_id = p_destination_warehouse_id,
                    updated_at = now()
                WHERE organization_id = p_organization_id
                  AND product_id = v_product_id
                  AND (serial_number_raw = v_serial_str OR serial_number_normalized = UPPER(TRIM(v_serial_str)) OR id::text = v_serial_str)
                RETURNING id INTO v_serial_id;

                -- Insert transaction serial row
                IF v_serial_id IS NOT NULL THEN
                    INSERT INTO public.inventory_transaction_serials (organization_id, transaction_item_id, product_serial_id)
                    VALUES (p_organization_id, v_tx_item_id, v_serial_id);
                END IF;
            END LOOP;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'transactionId', v_tx_id,
        'documentNumber', v_doc_no,
        'journalVoucherId', v_jv_id,
        'voucherNumber', v_voucher_no,
        'totalTransferCost', v_total_transfer_cost,
        'status', 'POSTED',
        'isReplay', false
    );
END;
$$;

-- ==============================================================================
-- 4. RPC: Reverse Warehouse Transfer Atomic
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.rpc_reverse_warehouse_transfer_atomic(
    p_organization_id UUID,
    p_user_id UUID,
    p_transaction_id UUID,
    p_reversal_reason TEXT,
    p_operation_key TEXT,
    p_request_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_orig_tx RECORD;
    v_item RECORD;
    v_dest_qty NUMERIC(18, 3);
    v_rev_doc_no BIGINT;
    v_rev_voucher_no BIGINT;
    v_rev_tx_id UUID;
    v_rev_jv_id UUID;
    v_source_sub_id UUID;
    v_dest_sub_id UUID;
    v_total_rev_cost BIGINT := 0;
    v_serial_row RECORD;
    v_existing_tx RECORD;
BEGIN
    -- 0. Idempotency Check for Reversal
    SELECT id, document_number, journal_voucher_id, request_fingerprint, status
    INTO v_existing_tx
    FROM public.inventory_transactions
    WHERE organization_id = p_organization_id
      AND transaction_kind = 'REVERSAL'
      AND idempotency_key = p_operation_key;

    IF v_existing_tx.id IS NOT NULL THEN
        IF v_existing_tx.request_fingerprint = p_request_fingerprint THEN
            RETURN jsonb_build_object(
                'reversalTransactionId', v_existing_tx.id,
                'reversalDocumentNumber', v_existing_tx.document_number,
                'reversalJournalVoucherId', v_existing_tx.journal_voucher_id,
                'status', v_existing_tx.status,
                'isReplay', true
            );
        ELSE
            RAISE EXCEPTION 'ERR_IDEMPOTENCY_CONFLICT: operation_key % already used with a different request fingerprint.', p_operation_key;
        END IF;
    END IF;

    -- 1. Lock original transaction
    SELECT * INTO v_orig_tx
    FROM public.inventory_transactions
    WHERE id = p_transaction_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF v_orig_tx.id IS NULL THEN
        RAISE EXCEPTION 'Transaction % not found.', p_transaction_id;
    END IF;

    IF v_orig_tx.status <> 'POSTED' OR v_orig_tx.transaction_type <> 'TRANSFER' THEN
        RAISE EXCEPTION 'Only POSTED TRANSFER transactions can be reversed. Current status: %', v_orig_tx.status;
    END IF;

    -- Check if destination warehouse currently has enough stock to reverse back
    FOR v_item IN
        SELECT product_id, source_warehouse_id, destination_warehouse_id, quantity, total_cost_amount, id AS item_id
        FROM public.inventory_transaction_items
        WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id
    LOOP
        SELECT quantity_on_hand INTO v_dest_qty
        FROM public.inventory_balances
        WHERE organization_id = p_organization_id
          AND warehouse_id = v_item.destination_warehouse_id
          AND product_id = v_item.product_id
        FOR UPDATE;

        IF v_dest_qty IS NULL OR v_dest_qty < v_item.quantity THEN
            RAISE EXCEPTION 'Cannot reverse transfer: destination warehouse has insufficient stock for product %.', v_item.product_id;
        END IF;

        v_total_rev_cost := v_total_rev_cost + v_item.total_cost_amount;
    END LOOP;

    -- Get warehouse account mappings
    SELECT subsidiary_id INTO v_source_sub_id
    FROM public.warehouse_inventory_account_mappings
    WHERE organization_id = p_organization_id AND warehouse_id = (
        SELECT source_warehouse_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id LIMIT 1
    ) AND status = 'CURRENT';

    SELECT subsidiary_id INTO v_dest_sub_id
    FROM public.warehouse_inventory_account_mappings
    WHERE organization_id = p_organization_id AND warehouse_id = (
        SELECT destination_warehouse_id FROM public.inventory_transaction_items WHERE transaction_id = p_transaction_id LIMIT 1
    ) AND status = 'CURRENT';

    -- Allocate document number & voucher number
    INSERT INTO public.inventory_document_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_orig_tx.fiscal_year_id, 1, p_user_id)
    ON CONFLICT DO NOTHING;

    SELECT next_number INTO v_rev_doc_no
    FROM public.inventory_document_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_orig_tx.fiscal_year_id
    FOR UPDATE;

    UPDATE public.inventory_document_sequences
    SET next_number = next_number + 1, updated_at = now(), updated_by = p_user_id
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_orig_tx.fiscal_year_id;

    INSERT INTO public.voucher_sequences (organization_id, fiscal_year_id, next_number, updated_by)
    VALUES (p_organization_id, v_orig_tx.fiscal_year_id, 1, p_user_id)
    ON CONFLICT DO NOTHING;

    SELECT next_number INTO v_rev_voucher_no
    FROM public.voucher_sequences
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_orig_tx.fiscal_year_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1, updated_at = now(), updated_by = p_user_id
    WHERE organization_id = p_organization_id AND fiscal_year_id = v_orig_tx.fiscal_year_id;

    -- Create Reversal Journal Voucher
    INSERT INTO public.journal_vouchers (
        organization_id,
        fiscal_year_id,
        voucher_number,
        voucher_date,
        voucher_type,
        status,
        description,
        reversal_of_voucher_id,
        created_by,
        posted_by,
        posted_at
    ) VALUES (
        p_organization_id,
        v_orig_tx.fiscal_year_id,
        v_rev_voucher_no,
        CURRENT_DATE,
        'TRANSFER',
        'POSTED',
        'سند برگشت انتقال بین انبار - سند اصلی شماره ' || v_orig_tx.document_number || ': ' || COALESCE(p_reversal_reason, ''),
        v_orig_tx.journal_voucher_id,
        p_user_id,
        p_user_id,
        now()
    ) RETURNING id INTO v_rev_jv_id;

    -- Reversal entries (Debit source warehouse, Credit destination warehouse)
    INSERT INTO public.voucher_entries (journal_voucher_id, row_number, subsidiary_id, debit, credit, description)
    VALUES (v_rev_jv_id, 1, v_source_sub_id, v_total_rev_cost, 0, 'برگشت بدهکار - موجودی انبار مبدأ');

    INSERT INTO public.voucher_entries (journal_voucher_id, row_number, subsidiary_id, debit, credit, description)
    VALUES (v_rev_jv_id, 2, v_dest_sub_id, 0, v_total_rev_cost, 'برگشت بستانکار - موجودی انبار مقصد');

    -- Update original journal voucher status
    IF v_orig_tx.journal_voucher_id IS NOT NULL THEN
        UPDATE public.journal_vouchers
        SET status = 'REVERSED', updated_at = now()
        WHERE id = v_orig_tx.journal_voucher_id AND organization_id = p_organization_id;
    END IF;

    -- Create Reversal Inventory Transaction
    INSERT INTO public.inventory_transactions (
        organization_id,
        fiscal_year_id,
        initiating_branch_id,
        document_number,
        transaction_date,
        transaction_type,
        transaction_kind,
        status,
        description,
        reversal_of_transaction_id,
        idempotency_key,
        request_fingerprint,
        journal_voucher_id,
        created_by,
        posted_by,
        posted_at
    ) VALUES (
        p_organization_id,
        v_orig_tx.fiscal_year_id,
        v_orig_tx.initiating_branch_id,
        v_rev_doc_no,
        CURRENT_DATE,
        'TRANSFER',
        'REVERSAL',
        'POSTED',
        'برگشت انتقال شماره ' || v_orig_tx.document_number || ': ' || COALESCE(p_reversal_reason, ''),
        p_transaction_id,
        p_operation_key,
        p_request_fingerprint,
        v_rev_jv_id,
        p_user_id,
        p_user_id,
        now()
    ) RETURNING id INTO v_rev_tx_id;

    -- Update original transaction
    UPDATE public.inventory_transactions
    SET status = 'REVERSED',
        reversed_by = p_user_id,
        reversed_at = now(),
        reversal_reason = p_reversal_reason,
        updated_at = now()
    WHERE id = p_transaction_id AND organization_id = p_organization_id;

    -- Revert balances & serials
    FOR v_item IN
        SELECT product_id, source_warehouse_id, destination_warehouse_id, quantity, id AS item_id
        FROM public.inventory_transaction_items
        WHERE transaction_id = p_transaction_id AND organization_id = p_organization_id
    LOOP
        -- Revert destination balance (-)
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand - v_item.quantity,
            updated_at = now()
        WHERE organization_id = p_organization_id
          AND warehouse_id = v_item.destination_warehouse_id
          AND product_id = v_item.product_id;

        -- Revert source balance (+)
        UPDATE public.inventory_balances
        SET quantity_on_hand = quantity_on_hand + v_item.quantity,
            updated_at = now()
        WHERE organization_id = p_organization_id
          AND warehouse_id = v_item.source_warehouse_id
          AND product_id = v_item.product_id;

        -- Revert serials back to source
        FOR v_serial_row IN
            SELECT product_serial_id FROM public.inventory_transaction_serials WHERE transaction_item_id = v_item.item_id
        LOOP
            UPDATE public.product_serials
            SET current_warehouse_id = v_item.source_warehouse_id,
                updated_at = now()
            WHERE id = v_serial_row.product_serial_id AND organization_id = p_organization_id;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'reversalTransactionId', v_rev_tx_id,
        'reversalDocumentNumber', v_rev_doc_no,
        'reversalJournalVoucherId', v_rev_jv_id,
        'reversalVoucherNumber', v_rev_voucher_no,
        'status', 'POSTED'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_account_mappings(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_warehouse_account_mapping(UUID, UUID, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_execute_warehouse_transfer_atomic(UUID, UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_warehouse_transfer_atomic(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
