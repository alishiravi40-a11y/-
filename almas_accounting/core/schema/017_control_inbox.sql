-- Almas Shahr accounting — core v0.17: one inbox of every control («کارتابل کنترل‌ها»).
--
-- Holoo had no control engine (W-25): each weakness had to be found by hand. Here every control of the core answers the
-- same question in the same shape — what needs a person's attention, how many, how much, how serious, and where it
-- comes from — so the dashboard, a person and an AI agent all read ONE list. A control with nothing to report returns
-- 0 items; an empty inbox is the goal. Controls are read-only: acting on an item goes through catalogued operations.

CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  -- sales below purchase price waiting for review (D-06, D-12)
  SELECT 'sales', 'S-01', 'high', 'هشدار فروش زیر قیمت خرید در انتظار بررسی', count(*), coalesce(sum(total_shortfall), 0), 'D-06, D-12'
  FROM core.below_cost_alert WHERE status = 'open'
  UNION ALL
  SELECT 'sales', 'S-02', 'medium', 'هشدار فروش زیر قیمت خرید با مهلت بررسی گذشته', count(*), coalesce(sum(total_shortfall), 0), 'D-12'
  FROM core.below_cost_alert WHERE status = 'open' AND review_due_at < p_as_of
  UNION ALL
  -- receivables (TRE-07)
  SELECT 'receivables', 'R-01', 'high', 'مطالبات بیش از ۹۰ روز از سررسید', count(*) FILTER (WHERE coalesce(d91_180, 0) + coalesce(d181_365, 0) + coalesce(over_365, 0) > 0),
         coalesce(sum(coalesce(d91_180, 0) + coalesce(d181_365, 0) + coalesce(over_365, 0)), 0), 'TRE-07, W-17'
  FROM core.aging(p_as_of)
  UNION ALL
  SELECT 'receivables', 'R-02', 'medium', 'بستانکاری تخصیص‌نیافته (پیش‌دریافت یا اضافه‌پرداخت)', count(*) FILTER (WHERE unapplied_credit > 0), coalesce(sum(unapplied_credit), 0), 'TRE-07'
  FROM core.aging(p_as_of)
  UNION ALL
  SELECT 'receivables', 'R-03', 'high', 'مغایرت سن‌بندی با مانده دفتر (باید صفر باشد)', count(*), coalesce(sum(abs(aging_net - ledger_balance)), 0), 'E21'
  FROM core.aging_control(p_as_of)
  UNION ALL
  -- cheques (W-12, W-32, W-34)
  SELECT 'cheques', 'C-01', 'high', 'چک دریافتی سررسیدگذشته که هنوز در صندوق است', count(*), coalesce(sum(s.amount), 0), 'W-12'
  FROM core.cheque_status s JOIN core.cashbox b ON b.cheque_account_id = s.account_id
  WHERE s.direction = 'in' AND s.kind = 'tracked' AND s.due_date < p_as_of
  UNION ALL
  SELECT 'cheques', 'C-02', 'medium', 'چک بدون وضعیت', count(*), coalesce(sum(amount), 0), 'E18'
  FROM core.cheque_status WHERE kind = 'no_event'
  UNION ALL
  -- inventory (W-11)
  SELECT 'inventory', 'I-01', 'low', 'کالا×انبار با سابقه موجودی منفی (انتقالی از هلو)', count(*), NULL::numeric, 'W-11'
  FROM core.inventory_negative_legacy
  UNION ALL
  -- tax (W-08, W-39)
  SELECT 'tax', t.control, t.severity, t.detail, t.documents, NULL::numeric, 'E25, W-08, W-39' FROM core.tax_controls(p_as_of) t
  UNION ALL
  -- Beta installment sales (B-01..B-14)
  SELECT 'beta', b.control, b.severity, b.title, b.items, b.amount, 'BETA_INSTALLMENTS_DESIGN' FROM core.beta_controls(p_as_of) b
  UNION ALL
  -- ledger integrity
  SELECT 'ledger', 'L-01', 'high', 'زنجیره هش Audit خراب است (باید صفر باشد)', count(*), NULL::numeric, 'W-02'
  FROM core.audit_chain_check WHERE NOT (link_ok AND hash_ok) $$;

INSERT INTO core.operation_catalog VALUES
  ('controls.inbox', 'read', 'core.control_inbox(date)', 'every control of the system in one list: what needs attention, how many, how much', NULL,
   'none', '—', 'W-25', true);
