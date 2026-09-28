-- Almas Shahr accounting — core v0.32: a Holoo year's opening stock is the previous year's closing, not new stock.
-- Evidence (E31): every one of the 211 item codes with opening stock in the real FY1405 backup opens with exactly the FY1404
-- closing quantity and average cost, and every FY1404 code with closing stock has that opening in FY1405. The core keeps
-- one kardex per item and warehouse across years, so adding the FY1405 opening as a movement counted that stock twice
-- (211 codes off, valuation off by 661 bn rials). Rule (migration/holoo_inventory.openings):
--   * no earlier stock history of the item in that warehouse → the opening is recorded as an opening movement (as before);
--   * earlier history exists (the previous year was imported) → no movement; the opening is CHECKED against the core's
--     quantity on the day before: equal → carried_forward; different → qty_differs (listed, reconciliation fails; a person
--     decides — nothing is guessed). The core's moving-average cost continues; Holoo's opening cost is kept for comparison.

CREATE TABLE core.legacy_opening_check (
  source_db text NOT NULL, legacy_code text NOT NULL, item_id int NOT NULL REFERENCES core.item, warehouse_id int REFERENCES core.warehouse,
  opening_date date NOT NULL, holoo_qty numeric NOT NULL, holoo_unit_cost numeric, core_qty numeric NOT NULL, core_avg_cost numeric,
  status text NOT NULL CHECK (status IN ('carried_forward', 'qty_differs')), run_id text, checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_db, legacy_code));
COMMENT ON TABLE core.legacy_opening_check IS 'a Holoo opening stock that continues the core''s own kardex (previous year imported): checked, not re-added';

CREATE FUNCTION core.inventory_opening_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT 'inventory', 'INV-OPEN', 'high', 'موجودی اول دوره هلو با موجودی پایان سال قبل در سیستم برابر نیست', count(*),
         sum(abs(holoo_qty - core_qty) * coalesce(holoo_unit_cost, 0)), 'E31'
  FROM core.legacy_opening_check WHERE status = 'qty_differs' $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v31;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v31(p_as_of) UNION ALL SELECT * FROM core.inventory_opening_controls(p_as_of) $$;
