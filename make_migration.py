import json

with open("supabase/migrations/16_invoice_update_atomic_foundation.sql", "r") as f:
    original = f.read()

parts = original.split("-- G. MUTATE FINANCIAL & INVENTORY LEDGERS")
if len(parts) != 2:
    print("Could not find G")
    exit(1)

part1 = parts[0]
part2 = parts[1]

parts2 = part2.split("-- H. Update Invoice Header Version & Timestamp")
if len(parts2) != 2:
    print("Could not find H")
    exit(1)

g_content = """-- G. MUTATE FINANCIAL & INVENTORY LEDGERS
    -- G1. We must bypass ledger immutability triggers temporarily for our atomic backend transaction
    PERFORM set_config('session_replication_role', 'replica', true);

    -- Fetch Subsidiary IDs
    SELECT id INTO v_sub_ar_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('1101', 'SUB_DEBTORS') LIMIT 1;
    SELECT id INTO v_sub_ap_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('2101', 'SUB_CREDITORS') LIMIT 1;
    SELECT id INTO v_sub_sales_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('4101', 'SUB_REVENUE') LIMIT 1;
    SELECT id INTO v_sub_inventory_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('1105', 'SUB_INVENTORY') LIMIT 1;
    SELECT id INTO v_sub_tax_buy_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('1108', 'SUB_VAT_BUY') LIMIT 1;
    SELECT id INTO v_sub_tax_sell_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('2105', 'SUB_VAT_SELL') LIMIT 1;
    SELECT id INTO v_sub_cash_id FROM public.subsidiary_account_maps WHERE organization_id = p_organization_id AND code IN ('1102', 'SUB_CASH_MAIN') LIMIT 1;

    -- ==============================================================================
    -- G2. RE-CALCULATE AND INSERT INVOICE ITEMS
    -- ==============================================================================
    DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;
    
    FOR i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
        v_item_json := p_items->i;
        
        INSERT INTO public.invoice_items (
            organization_id,
            invoice_id,
            product_id,
            warehouse_id,
            quantity,
            unit_price,
            discount_amount,
            tax_percent,
            tax_amount,
            net_amount,
            total_amount,
            row_number,
            description
        ) VALUES (
            p_organization_id,
            p_invoice_id,
            (v_item_json->>'product_id')::UUID,
            (v_item_json->>'warehouse_id')::UUID,
            (v_item_json->>'quantity')::NUMERIC,
            (v_item_json->>'unit_price')::NUMERIC,
            COALESCE((v_item_json->>'discount_amount')::NUMERIC, 0),
            COALESCE((v_item_json->>'tax_percent')::NUMERIC, 0),
            COALESCE((v_item_json->>'tax_amount')::NUMERIC, 0),
            COALESCE((v_item_json->>'net_amount')::NUMERIC, 0),
            COALESCE((v_item_json->>'total_amount')::NUMERIC, 0),
            i + 1,
            v_item_json->>'description'
        );
    END LOOP;

    -- ==============================================================================
    -- G3. UPDATE INVENTORY LEDGER
    -- ==============================================================================
    -- Delete old stock effects
    DELETE FROM public.inventory_transaction_items WHERE transaction_id = v_invoice.inventory_transaction_id;

    -- Insert new stock effects
    FOR i IN 0 .. jsonb_array_length(p_items) - 1 LOOP
        v_item_json := p_items->i;
        
        INSERT INTO public.inventory_transaction_items (
            organization_id,
            transaction_id,
            product_id,
            source_warehouse_id,
            destination_warehouse_id,
            quantity,
            unit_cost_amount,
            total_cost_amount,
            row_number
        ) VALUES (
            p_organization_id,
            v_invoice.inventory_transaction_id,
            (v_item_json->>'product_id')::UUID,
            CASE WHEN v_invoice.invoice_type = 'SELL' THEN (v_item_json->>'warehouse_id')::UUID ELSE NULL END,
            CASE WHEN v_invoice.invoice_type = 'BUY' THEN (v_item_json->>'warehouse_id')::UUID ELSE NULL END,
            (v_item_json->>'quantity')::NUMERIC,
            COALESCE((v_item_json->>'unit_cost_amount')::NUMERIC, 0),
            COALESCE((v_item_json->>'total_cost_amount')::NUMERIC, 0),
            i + 1
        );
    END LOOP;

    -- Manually Validate Negative Stock for SELL invoices
    IF v_invoice.invoice_type = 'SELL' THEN
        FOR v_check_item IN (
            SELECT product_id, source_warehouse_id 
            FROM public.inventory_transaction_items 
            WHERE transaction_id = v_invoice.inventory_transaction_id 
              AND source_warehouse_id IS NOT NULL
        ) LOOP
            SELECT COALESCE(sum(
                CASE WHEN destination_warehouse_id = v_check_item.source_warehouse_id THEN quantity ELSE 0 END
            ) - sum(
                CASE WHEN source_warehouse_id = v_check_item.source_warehouse_id THEN quantity ELSE 0 END
            ), 0)
            INTO v_stock
            FROM public.vw_inventory_ledger
            WHERE product_id = v_check_item.product_id
              AND (source_warehouse_id = v_check_item.source_warehouse_id OR destination_warehouse_id = v_check_item.source_warehouse_id);

            IF v_stock < 0 THEN
                RAISE EXCEPTION 'Negative stock not allowed for product % in warehouse % (Stock: %)', v_check_item.product_id, v_check_item.source_warehouse_id, v_stock;
            END IF;
        END LOOP;
    END IF;

    -- ==============================================================================
    -- G4. UPDATE ACCOUNTING VOUCHER
    -- ==============================================================================
    DELETE FROM public.voucher_entries WHERE voucher_id = v_invoice.journal_voucher_id;

    v_row_num := 1;
    v_total_debit := 0;
    v_total_credit := 0;
    v_remaining := v_calculated_total - (v_final_cash_paid + v_final_pos_paid);

    IF v_invoice.invoice_type = 'SELL' THEN
        IF v_final_cash_paid > 0 AND v_sub_cash_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_cash_id, NULL, p_cost_center_id, v_final_cash_paid, 0, 
                'دریافت نقدی بابت فاکتور فروش شماره ' || v_invoice.invoice_number
            );
            v_total_debit := v_total_debit + v_final_cash_paid;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_remaining > 0 OR (v_final_cash_paid = 0 AND v_final_pos_paid = 0) THEN
            v_actual_debt := CASE WHEN v_remaining > 0 THEN v_remaining ELSE v_calculated_total END;
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, COALESCE(v_sub_ar_id, v_sub_cash_id), p_person_id, p_cost_center_id, v_actual_debt, 0, 
                'فروش نسیه - فاکتور شماره ' || v_invoice.invoice_number || ' (' || COALESCE(p_person_id::text, '') || ')'
            );
            v_total_debit := v_total_debit + v_actual_debt;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_sub_sales_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_sales_id, NULL, p_cost_center_id, 0, v_taxable_base, 
                'فروش طی فاکتور شماره ' || v_invoice.invoice_number
            );
            v_total_credit := v_total_credit + v_taxable_base;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_calculated_tax > 0 AND v_sub_tax_sell_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_tax_sell_id, NULL, p_cost_center_id, 0, v_calculated_tax, 
                'مالیات ارزش افزوده فاکتور فروش ' || v_invoice.invoice_number
            );
            v_total_credit := v_total_credit + v_calculated_tax;
            v_row_num := v_row_num + 1;
        END IF;

    ELSIF v_invoice.invoice_type = 'BUY' THEN
        IF v_sub_inventory_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_inventory_id, NULL, p_cost_center_id, v_taxable_base, 0, 
                'خرید طی فاکتور شماره ' || v_invoice.invoice_number
            );
            v_total_debit := v_total_debit + v_taxable_base;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_calculated_tax > 0 AND v_sub_tax_buy_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_tax_buy_id, NULL, p_cost_center_id, v_calculated_tax, 0, 
                'مالیات ارزش افزوده فاکتور خرید ' || v_invoice.invoice_number
            );
            v_total_debit := v_total_debit + v_calculated_tax;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_final_cash_paid > 0 AND v_sub_cash_id IS NOT NULL THEN
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, v_sub_cash_id, NULL, p_cost_center_id, 0, v_final_cash_paid, 
                'پرداخت نقدی بابت فاکتور خرید شماره ' || v_invoice.invoice_number
            );
            v_total_credit := v_total_credit + v_final_cash_paid;
            v_row_num := v_row_num + 1;
        END IF;

        IF v_remaining > 0 OR (v_final_cash_paid = 0 AND v_final_pos_paid = 0) THEN
            v_actual_debt := CASE WHEN v_remaining > 0 THEN v_remaining ELSE v_calculated_total END;
            INSERT INTO public.voucher_entries (
                organization_id, voucher_id, row_number, subsidiary_id, person_id, cost_center_id, debit, credit, description
            ) VALUES (
                p_organization_id, v_invoice.journal_voucher_id, v_row_num, COALESCE(v_sub_ap_id, v_sub_cash_id), p_person_id, p_cost_center_id, 0, v_actual_debt, 
                'خرید نسیه - فاکتور شماره ' || v_invoice.invoice_number || ' (' || COALESCE(p_person_id::text, '') || ')'
            );
            v_total_credit := v_total_credit + v_actual_debt;
            v_row_num := v_row_num + 1;
        END IF;
    END IF;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Voucher unbalanced after generation: Debit % != Credit %', v_total_debit, v_total_credit;
    END IF;

    -- Update Voucher totals
    UPDATE public.journal_vouchers 
    SET total_debit = v_total_debit, 
        total_credit = v_total_credit,
        version = version + 1
    WHERE id = v_invoice.journal_voucher_id;

    -- G5. Restore trigger execution
    PERFORM set_config('session_replication_role', 'origin', true);

    """

new_content = part1 + g_content + "-- H. Update Invoice Header Version & Timestamp" + parts2[1]

declare_block = new_content.find("DECLARE")
if declare_block != -1:
    end_declare = new_content.find("BEGIN", declare_block)
    declarations = new_content[declare_block:end_declare]
    
    needed = [
        "v_check_item RECORD;",
        "v_stock NUMERIC;",
        "v_row_num INT;",
        "v_total_debit NUMERIC;",
        "v_total_credit NUMERIC;",
        "v_remaining NUMERIC;",
        "v_actual_debt NUMERIC;",
        "v_sub_cash_id UUID;",
        "v_sub_ar_id UUID;",
        "v_sub_ap_id UUID;",
        "v_sub_sales_id UUID;",
        "v_sub_inventory_id UUID;",
        "v_sub_tax_sell_id UUID;",
        "v_sub_tax_buy_id UUID;"
    ]
    
    insert_decls = ""
    for n in needed:
        if n not in declarations:
            insert_decls += "    " + n + "\n"
            
    if insert_decls:
        new_content = new_content[:end_declare] + insert_decls + new_content[end_declare:]

with open("supabase/migrations/16_invoice_update_atomic_foundation.sql", "w") as f:
    f.write(new_content)

print("Modified successfully")
