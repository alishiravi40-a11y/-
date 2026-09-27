-- Almas Shahr accounting — core v0.20: management reports (sales, gross margin, inventory status).
--
-- Periodic inventory (D-02): the ledger has no cost line per sale, so a MONTHLY gross margin needs a cost estimate.
-- It is taken from the kardex (012): the derived cost of every sale less every sales return. The annual total of this
-- estimate is reported NEXT TO the ledger's year-end cost of goods sold (011, Holoo's formula), so the difference
-- between the two methods is always visible — never hidden (see migration/README for 1404).
-- Revenue comes from the ledger: sales − sales returns − cash discounts given (settings of 006/007).

-- kardex cost of sales and returns, per day (all items); periods are Jalali months, so days are summed into periods
CREATE FUNCTION core.kardex_cost_of_sales(p_from date, p_to date)
RETURNS TABLE (day date, cost_of_sales numeric, cost_of_returns numeric, units_sold numeric) LANGUAGE sql STABLE AS $$
  SELECT k.effective_date, coalesce(sum(-k.value) FILTER (WHERE k.kind = 'sale'), 0),
         coalesce(sum(k.value) FILTER (WHERE k.kind = 'sale_return'), 0), sum(-k.qty) FILTER (WHERE k.kind = 'sale')
  FROM core.item i CROSS JOIN LATERAL core.item_kardex(i.id, p_to) k
  WHERE EXISTS (SELECT 1 FROM core.stock_movement s WHERE s.item_id = i.id AND s.kind IN ('sale', 'sale_return'))
    AND k.effective_date BETWEEN p_from AND p_to AND k.kind IN ('sale', 'sale_return')
  GROUP BY 1 $$;

-- monthly sales and gross margin of a fiscal year, by accounting period
CREATE FUNCTION core.monthly_sales_margin(p_year text)
RETURNS TABLE (period text, starts_on date, ends_on date, gross_sales numeric, returns_and_discounts numeric, net_sales numeric,
               cost_of_sales_kardex numeric, gross_margin numeric, margin_percent numeric) LANGUAGE sql STABLE AS $$
  WITH p AS (SELECT pr.code, pr.starts_on, pr.ends_on FROM core.period pr JOIN core.fiscal_year y ON y.id = pr.fiscal_year_id WHERE y.code = p_year),
  acc AS (SELECT core.setting_account('account_sales') s, core.setting_account('account_sales_return') r, core.setting_account('account_sales_cash_discount') d),
  rev AS (
    SELECT p.code, sum(l.credit - l.debit) FILTER (WHERE l.account_id IN (SELECT a.id FROM core.account_ancestor x JOIN core.account a ON a.id = x.account_id
                                                                         WHERE x.ancestor_id = (SELECT s FROM acc))) AS gross,
           sum(l.debit - l.credit) FILTER (WHERE l.account_id IN ((SELECT r FROM acc), (SELECT d FROM acc))) AS rd
    FROM p JOIN core.year_lines(p_year) l ON l.effective_date BETWEEN p.starts_on AND p.ends_on AND l.kind NOT IN ('closing', 'opening')
    GROUP BY p.code),
  cost AS (SELECT p.code, sum(k.cost_of_sales - k.cost_of_returns) c
           FROM p JOIN core.kardex_cost_of_sales((SELECT min(starts_on) FROM p), (SELECT max(ends_on) FROM p)) k ON k.day BETWEEN p.starts_on AND p.ends_on
           GROUP BY p.code)
  SELECT p.code, p.starts_on, p.ends_on, coalesce(rev.gross, 0), coalesce(rev.rd, 0), coalesce(rev.gross, 0) - coalesce(rev.rd, 0),
         round(coalesce(cost.c, 0)), coalesce(rev.gross, 0) - coalesce(rev.rd, 0) - round(coalesce(cost.c, 0)),
         CASE WHEN coalesce(rev.gross, 0) - coalesce(rev.rd, 0) <> 0
              THEN round(100 * (coalesce(rev.gross, 0) - coalesce(rev.rd, 0) - coalesce(cost.c, 0)) / (coalesce(rev.gross, 0) - coalesce(rev.rd, 0)), 1) END
  FROM p LEFT JOIN rev ON rev.code = p.code LEFT JOIN cost ON cost.code = p.code ORDER BY p.starts_on $$;

-- stock of every model × warehouse with value and movement recency (slow-moving stock)
CREATE FUNCTION core.inventory_status(p_as_of date)
RETURNS TABLE (item_id int, item_code text, item_name text, warehouse_name text, qty numeric, avg_cost numeric, value numeric,
               last_sale date, days_since_last_sale int) LANGUAGE sql STABLE AS $$
  SELECT v.item_id, i.code, i.name, w.name, v.qty, v.avg_cost, v.value,
         (SELECT max(s.effective_date) FROM core.stock_movement_live s WHERE s.item_id = v.item_id AND s.warehouse_id = v.warehouse_id
            AND s.kind = 'sale' AND s.effective_date <= p_as_of),
         p_as_of - (SELECT max(s.effective_date) FROM core.stock_movement_live s WHERE s.item_id = v.item_id AND s.warehouse_id = v.warehouse_id
            AND s.kind = 'sale' AND s.effective_date <= p_as_of)
  FROM core.inventory_valuation(p_as_of) v JOIN core.item i ON i.id = v.item_id JOIN core.warehouse w ON w.id = v.warehouse_id
  WHERE v.qty <> 0 ORDER BY v.value DESC $$;

INSERT INTO core.operation_catalog VALUES
  ('reports.monthly_margin', 'read', 'core.monthly_sales_margin(text)', 'monthly net sales and gross margin (cost from the kardex; periodic inventory D-02)', NULL,
   'none', '—', 'D-02, E23', true),
  ('reports.inventory_status', 'read', 'core.inventory_status(date)', 'stock, value and days since last sale per model and warehouse', NULL, 'none', '—', 'E23', true);
