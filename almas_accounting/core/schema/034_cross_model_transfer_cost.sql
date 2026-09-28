-- Almas Shahr accounting — core v0.34: a legacy transfer between two models still moves at the SOURCE's average.
-- Evidence (E31): Holoo moves a transfer at the source code's average (E11.7). A few Holoo transfers go from a code of
-- one model to a code of another (kept as history, listed by core.inventory_cross_model_transfers, refused for new
-- transfers — core 012): 5 in FY1404, 9 in FY1405. item_kardex replays ONE item, so the source side of such a transfer
-- was not in its replay and the destination received the goods at cost 0 (FY1405: one unit valued at 0 instead of
-- 1,001,672,326 rials, most of the −316.7 M valuation difference). Rule: a transfer_in whose transfer_out belongs to
-- another item takes that transfer_out's cost from the other item's own kardex (up to the same date). The lookup is
-- bounded (depth 4): items that pass goods back and forth cannot recurse without end; beyond the bound the cost is 0
-- and shows up in the kardex parity, as before. Items without such transfers are replayed exactly as before.

CREATE FUNCTION core.item_kardex_depth(p_item int, p_to date, p_depth int)
RETURNS TABLE (movement_id bigint, warehouse_id int, kind text, effective_date date, effective_time time, qty numeric,
               unit_cost numeric, value numeric, qty_after numeric, avg_cost_after numeric) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE m record; q jsonb := '{}'; a jsonb := '{}'; wq numeric; wa numeric; uc numeric; src_avg jsonb := '{}';
BEGIN
  FOR m IN SELECT * FROM core.stock_movement_live s WHERE s.item_id = p_item AND (p_to IS NULL OR s.effective_date <= p_to)
           ORDER BY s.effective_date, s.effective_time, s.sort_order, s.id LOOP
    wq := coalesce((q ->> m.warehouse_id::text)::numeric, 0); wa := coalesce((a ->> m.warehouse_id::text)::numeric, 0);
    IF m.direction = 1 THEN
      uc := CASE m.kind WHEN 'purchase' THEN m.unit_price + m.extra_cost_per_unit
                        WHEN 'transfer_in' THEN coalesce(
                          (src_avg ->> m.transfer_id::text)::numeric,
                          -- same item, source not replayed yet (same moment): the source warehouse's current average
                          (SELECT (a ->> o.warehouse_id::text)::numeric FROM core.stock_movement o
                           WHERE o.transfer_id = m.transfer_id AND o.kind = 'transfer_out' AND o.item_id = p_item LIMIT 1),
                          -- another item (legacy cross-model transfer): the cost it left with, from that item's kardex
                          (SELECT k.unit_cost FROM core.stock_movement o
                           CROSS JOIN LATERAL core.item_kardex_depth(o.item_id, o.effective_date, p_depth + 1) k
                           WHERE p_depth < 4 AND o.transfer_id = m.transfer_id AND o.kind = 'transfer_out' AND o.item_id <> p_item
                             AND k.movement_id = o.id LIMIT 1),
                          0)
                        ELSE coalesce(m.unit_price, wa) END;
      wa := CASE WHEN wq + m.qty <> 0 THEN (wq * wa + m.qty * uc) / (wq + m.qty) ELSE uc END;
      wq := wq + m.qty;
    ELSE
      uc := wa;
      IF m.kind = 'transfer_out' THEN src_avg := src_avg || jsonb_build_object(m.transfer_id::text, wa); END IF;
      wq := wq - m.qty;
    END IF;
    q := q || jsonb_build_object(m.warehouse_id::text, wq); a := a || jsonb_build_object(m.warehouse_id::text, wa);
    movement_id := m.id; warehouse_id := m.warehouse_id; kind := m.kind; effective_date := m.effective_date;
    effective_time := m.effective_time; qty := m.qty * m.direction; unit_cost := round(uc, 4); value := round(m.qty * m.direction * uc, 2);
    qty_after := wq; avg_cost_after := round(wa, 4);
    RETURN NEXT;
  END LOOP;
END $$;
COMMENT ON FUNCTION core.item_kardex_depth(int, date, int) IS 'item_kardex with the bounded look-up into another item for legacy cross-model transfers (core 034)';

CREATE OR REPLACE FUNCTION core.item_kardex(p_item int, p_to date DEFAULT NULL)
RETURNS TABLE (movement_id bigint, warehouse_id int, kind text, effective_date date, effective_time time, qty numeric,
               unit_cost numeric, value numeric, qty_after numeric, avg_cost_after numeric) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.item_kardex_depth(p_item, p_to, 0) $$;
