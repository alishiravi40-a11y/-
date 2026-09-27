-- Almas Shahr accounting — core v0.12: inventory (stock movements, moving-average valuation, kardex).
--
-- What is PROVEN about Holoo (E11, E23) and kept:
--   * quantity: in = purchase (K), sales return (Y), transfer in (D); out = sale (F), purchase return (X), waste (Z),
--     transfer out (S); pre-invoice (Q) moves nothing — E11.1: stock = opening + Σ movements for all 9,596 goods;
--   * cost: moving weighted average per item code, which in Holoo is per warehouse; a transfer moves at the source's
--     average (E11.7); the replay order is Holoo's own «kardex for calculating price» (W_ArtKardexForCalcPrice):
--     date, time, then type order K=1, F=2, Y=3, X=4, Z=5, D=9, S=10; a purchase enters at its price plus the
--     invoice's extra costs per unit (HazFactK / Sum_Few). Reproduces the stored cost of 31,219 of 33,571 outgoing
--     lines of 1404; every miss lies in an item whose stock went negative (89 of 99) or is unexplained (10) (E23);
--   * the year-end ending inventory is Σ stock × average cost over ALL items (E22: exactly Holoo's closing input).
-- What is NEW (Holoo weaknesses not repeated):
--   * the item is the MODEL (D-04/D-13) and stock is per item × warehouse (W-18);
--   * the cost of an issue is DERIVED from the movements every time, so a movement entered later with an earlier date
--     re-costs everything after it (W-10: Holoo froze line costs; 101 sale lines at zero cost);
--   * negative stock is refused (W-11, INV-06) — movements migrated from Holoo, which allowed it, are exempt and listed
--     by core.inventory_negative_legacy;
--   * movements are immutable; a wrong one is reversed.
-- Periodic inventory (D-02): movements carry no journal lines; the valuation feeds the year-end close (011).

CREATE TABLE core.warehouse (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, holoo_group_code text, active boolean NOT NULL DEFAULT true);

ALTER TABLE core.item ADD COLUMN is_service boolean NOT NULL DEFAULT false,      -- services have no stock
                      ADD COLUMN model_key text;                                  -- normalized name (D-13)
CREATE UNIQUE INDEX item_model_key ON core.item (model_key) WHERE model_key IS NOT NULL;

-- Holoo item code (per warehouse) → model × warehouse
CREATE TABLE core.item_legacy_code (
  source_db text NOT NULL, legacy_code text NOT NULL, legacy_name text, item_id int NOT NULL REFERENCES core.item,
  warehouse_id int REFERENCES core.warehouse, PRIMARY KEY (source_db, legacy_code));

CREATE TABLE core.stock_movement_kind (
  kind text PRIMARY KEY, direction smallint NOT NULL CHECK (direction IN (1, -1)), sort_order smallint NOT NULL,
  holoo_type text, description text NOT NULL);
INSERT INTO core.stock_movement_kind VALUES
  ('opening',         1, 0, NULL, 'stock and cost at the start of the fiscal year'),
  ('purchase',        1, 1, 'K',  'purchase invoice: enters at unit price + extra costs per unit'),
  ('sale',           -1, 2, 'F',  'sales invoice: leaves at the moving average'),
  ('sale_return',     1, 3, 'Y',  'return from a customer: enters at the cost given on the return'),
  ('purchase_return',-1, 4, 'X',  'return to a supplier: leaves at the moving average'),
  ('waste',          -1, 5, 'Z',  'waste / loss: leaves at the moving average'),
  ('transfer_in',     1, 9, 'D',  'transfer from another warehouse: enters at the source average'),
  ('transfer_out',   -1, 10, 'S', 'transfer to another warehouse: leaves at the moving average');

CREATE TABLE core.stock_movement (
  id bigserial PRIMARY KEY, item_id int NOT NULL REFERENCES core.item, warehouse_id int NOT NULL REFERENCES core.warehouse,
  kind text NOT NULL REFERENCES core.stock_movement_kind, effective_date date NOT NULL, effective_time time NOT NULL DEFAULT '00:00',
  qty numeric(18,3) NOT NULL,          -- > 0; only a legacy opening may be negative (Holoo carried 12 negative openings: E11.8)
  CHECK (qty > 0 OR (kind = 'opening' AND legacy AND qty <> 0)),
  unit_price numeric(20,2),            -- purchase: invoice unit price; opening / sale_return: the given unit cost
  extra_cost_per_unit numeric(20,4) NOT NULL DEFAULT 0 CHECK (extra_cost_per_unit >= 0),   -- purchase: landed costs
  transfer_id bigint,                  -- pairs transfer_out and transfer_in
  source text NOT NULL, source_ref text,    -- e.g. 'holoo:holoo1_1404:F:12345:3' / 'sales_invoice:17'
  reverses_id bigint REFERENCES core.stock_movement, legacy boolean NOT NULL DEFAULT false,
  created_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind NOT IN ('purchase', 'opening', 'sale_return') OR unit_price IS NOT NULL));
CREATE INDEX stock_movement_item ON core.stock_movement (item_id, warehouse_id, effective_date, effective_time);
CREATE UNIQUE INDEX stock_movement_source ON core.stock_movement (source_ref) WHERE source_ref IS NOT NULL AND reverses_id IS NULL;
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON core.stock_movement FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- live movements (a reversed movement and its reversal both drop out)
CREATE VIEW core.stock_movement_live AS
SELECT m.*, k.direction, k.sort_order FROM core.stock_movement m JOIN core.stock_movement_kind k USING (kind)
WHERE m.reverses_id IS NULL AND NOT EXISTS (SELECT 1 FROM core.stock_movement r WHERE r.reverses_id = m.id);

-- The kardex of one item across all its warehouses, replayed in Holoo's proven order, with quantity, average cost and
-- the cost of every movement. Everything is derived: nothing about cost is stored, so it can never go stale (W-10).
CREATE FUNCTION core.item_kardex(p_item int, p_to date DEFAULT NULL)
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
                        WHEN 'transfer_in' THEN coalesce((src_avg ->> m.transfer_id::text)::numeric,
                                                         (SELECT (a ->> o.warehouse_id::text)::numeric FROM core.stock_movement o
                                                          WHERE o.transfer_id = m.transfer_id AND o.kind = 'transfer_out' LIMIT 1), 0)
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

-- stock and value of every item × warehouse at a date (the last kardex row of each)
CREATE FUNCTION core.inventory_valuation(p_as_of date)
RETURNS TABLE (item_id int, warehouse_id int, qty numeric, avg_cost numeric, value numeric) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (k.warehouse_id, i.id) i.id, k.warehouse_id, k.qty_after, k.avg_cost_after, round(k.qty_after * k.avg_cost_after, 2)
  FROM core.item i CROSS JOIN LATERAL core.item_kardex(i.id, p_as_of) WITH ORDINALITY k
  WHERE EXISTS (SELECT 1 FROM core.stock_movement s WHERE s.item_id = i.id)
  ORDER BY k.warehouse_id, i.id, k.ordinality DESC $$;

-- negative stock: refused for new movements (W-11); legacy movements are exempt but listed
CREATE FUNCTION core.trg_stock_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE worst numeric;
BEGIN
  IF NEW.legacy THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stock'), NEW.item_id);
  -- after this movement, the running quantity of its warehouse from its date onward must never be below zero
  SELECT min(k.qty_after) INTO worst FROM core.item_kardex(NEW.item_id) k
  WHERE k.warehouse_id = NEW.warehouse_id AND k.effective_date >= NEW.effective_date;
  IF worst < 0 THEN RAISE EXCEPTION 'stock of item % in warehouse % would become negative (%): W-11', NEW.item_id, NEW.warehouse_id, worst; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER stock_no_negative AFTER INSERT ON core.stock_movement DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.trg_stock_no_negative();

CREATE VIEW core.inventory_negative_legacy AS
SELECT i.id AS item_id, i.code, k.warehouse_id, min(k.qty_after) AS worst_qty, count(*) AS movements_below_zero
FROM core.item i CROSS JOIN LATERAL core.item_kardex(i.id) k
WHERE k.qty_after < 0 AND EXISTS (SELECT 1 FROM core.stock_movement s WHERE s.item_id = i.id AND s.legacy)
GROUP BY i.id, i.code, k.warehouse_id;

-- ending inventory for the year-end close (011): the valuation, with its source for the audit trail
CREATE FUNCTION core.ending_inventory_value(p_year text) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(round(sum(v.value)), 0) FROM core.fiscal_year y, core.inventory_valuation(y.ends_on) v WHERE y.code = p_year $$;
