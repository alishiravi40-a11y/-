-- Almas Shahr accounting — core v0.29: coexistence with Holoo (D-07, open) — the same business event must not be counted twice.
-- While Holoo is still the working system, its backups are imported as legacy entries; entries recorded natively in the new
-- system for the same days would add to them. Which book is the book of record from which date is the owner's decision (D-07):
-- until it is made, every native entry in a period that also holds Holoo entries is listed; once it is made (setting
-- book_of_record_from), Holoo entries dated on or after it and native entries dated before it are listed. Nothing is
-- blocked or netted automatically: which of two copies is the real one is a fact a person checks.

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('book_of_record_from', '', NULL, '^$|^[0-9]{4}-[0-9]{2}-[0-9]{2}$', 'D-07');

CREATE FUNCTION core.coexistence_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  WITH cut AS (SELECT NULLIF(core.setting_value('book_of_record_from'), '')::date AS d),
  e AS (SELECT je.id, je.period_id, je.effective_date, je.source = 'holoo' AS legacy,
               (SELECT sum(debit) FROM core.journal_line l WHERE l.entry_id = je.id) AS amt
        FROM core.journal_entry je WHERE je.status <> 'draft' AND je.kind NOT IN ('opening', 'closing') AND je.effective_date <= p_as_of),
  mixed AS (SELECT period_id FROM e GROUP BY 1 HAVING bool_or(legacy) AND bool_or(NOT legacy))
  SELECT 'coexistence', 'COEX-01', 'high', 'سند در سیستم جدید و هلو برای یک دوره (مرجع رسمی دفاتر هنوز تعیین نشده؛ خطر دوباره‌شماری)',
         count(*), sum(amt), 'D-07'
  FROM e WHERE NOT legacy AND (SELECT d FROM cut) IS NULL AND period_id IN (SELECT period_id FROM mixed)
  UNION ALL
  SELECT 'coexistence', 'COEX-02', 'high', 'سند هلو با تاریخ پس از شروع دفاتر رسمی سیستم جدید', count(*), sum(amt), 'D-07'
  FROM e WHERE legacy AND e.effective_date >= (SELECT d FROM cut)
  UNION ALL
  SELECT 'coexistence', 'COEX-03', 'medium', 'سند سیستم جدید با تاریخ پیش از شروع دفاتر رسمی آن (دوره‌ای که هلو مرجع است)', count(*), sum(amt), 'D-07'
  FROM e WHERE NOT legacy AND e.effective_date < (SELECT d FROM cut) $$;

ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v28;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v28(p_as_of) UNION ALL SELECT * FROM core.coexistence_controls(p_as_of) $$;
