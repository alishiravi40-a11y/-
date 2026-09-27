-- Almas Shahr accounting — core v0.9: the standard accounting reports, defined once in the database.
-- Semantics are taken from Holoo's own server-side report logic (restored 1404 backup, E20) and proven equal by
-- migration/report_parity.py:
--   * four-column trial balance («تراز چهارستونی», MakeTarazTajmieeTbl): per code, period debit / credit turnover and the
--     balance split into debit / credit; rolled up kol → moein → tafsili (W_SarfaslMandeh);
--   * balance of a party «as of» a date (Calc_BedBes_UseInFuncDate): EXCLUDES temporary-closing and closing vouchers
--     (Sanad_State 2, 3 → journal_entry.kind = 'closing');
--   * account / party ledger with running balance («مرور حساب / دفتر معین اشخاص», spMoienAshkhas): INCLUDES all vouchers,
--     ordered by date then voucher number then line.
-- Every report takes the fiscal year explicitly: the new system keeps all years in one database (W-19).

-- every account with itself and all its ancestors
CREATE VIEW core.account_ancestor AS
WITH RECURSIVE t AS (
  SELECT a.id AS account_id, a.id AS ancestor_id FROM core.account a
  UNION ALL
  SELECT t.account_id, p.parent_id FROM t JOIN core.account p ON p.id = t.ancestor_id WHERE p.parent_id IS NOT NULL)
SELECT account_id, ancestor_id FROM t;

-- posted lines of one fiscal year (the base of every report)
CREATE FUNCTION core.year_lines(p_year text)
RETURNS TABLE (entry_id bigint, line_no int, number bigint, effective_date date, kind text, account_id int, party_id int,
               debit numeric, credit numeric, description text, entry_description text) LANGUAGE sql STABLE AS $$
  SELECT l.entry_id, l.line_no, e.number, e.effective_date, e.kind, l.account_id, l.party_id, l.debit, l.credit, l.description, e.description
  FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft'
  JOIN core.fiscal_year y ON y.id = e.fiscal_year_id AND y.code = p_year $$;

-- four-column trial balance per (account, party) for [p_from, p_to] of a fiscal year
CREATE FUNCTION core.trial_balance_period(p_year text, p_from date, p_to date, p_include_closing boolean DEFAULT false)
RETURNS TABLE (account_id int, party_id int, opening numeric, period_debit numeric, period_credit numeric, closing numeric,
               closing_debit numeric, closing_credit numeric) LANGUAGE sql STABLE AS $$
  WITH x AS (
    SELECT l.account_id, l.party_id,
           sum(l.debit - l.credit) FILTER (WHERE l.effective_date < p_from) AS opening,
           coalesce(sum(l.debit) FILTER (WHERE l.effective_date BETWEEN p_from AND p_to), 0) AS pd,
           coalesce(sum(l.credit) FILTER (WHERE l.effective_date BETWEEN p_from AND p_to), 0) AS pc
    FROM core.year_lines(p_year) l
    WHERE l.effective_date <= p_to AND (p_include_closing OR l.kind <> 'closing')
    GROUP BY l.account_id, l.party_id)
  SELECT account_id, party_id, coalesce(opening, 0), pd, pc, coalesce(opening, 0) + pd - pc,
         greatest(coalesce(opening, 0) + pd - pc, 0), greatest(-(coalesce(opening, 0) + pd - pc), 0)
  FROM x $$;

-- the same, rolled up to every level of the chart (a party row only on its own account)
CREATE FUNCTION core.trial_balance_levels(p_year text, p_from date, p_to date, p_include_closing boolean DEFAULT false)
RETURNS TABLE (code text, name text, level smallint, party_id int, opening numeric, period_debit numeric, period_credit numeric,
               closing numeric, closing_debit numeric, closing_credit numeric) LANGUAGE sql STABLE AS $$
  WITH tb AS (SELECT * FROM core.trial_balance_period(p_year, p_from, p_to, p_include_closing)),
  r AS (
    SELECT an.ancestor_id AS account_id, NULL::int AS party_id, sum(tb.opening) o, sum(tb.period_debit) d, sum(tb.period_credit) c
    FROM tb JOIN core.account_ancestor an ON an.account_id = tb.account_id GROUP BY an.ancestor_id
    UNION ALL
    SELECT tb.account_id, tb.party_id, tb.opening, tb.period_debit, tb.period_credit FROM tb WHERE tb.party_id IS NOT NULL)
  SELECT a.code, a.name, a.level, r.party_id, r.o, r.d, r.c, r.o + r.d - r.c, greatest(r.o + r.d - r.c, 0), greatest(-(r.o + r.d - r.c), 0)
  FROM r JOIN core.account a ON a.id = r.account_id $$;

-- balance of every party (per account) as of a date, closing vouchers excluded (Holoo Calc_BedBes_UseInFuncDate)
CREATE FUNCTION core.party_balance_at(p_year text, p_as_of date)
RETURNS TABLE (account_id int, party_id int, debit numeric, credit numeric, balance numeric) LANGUAGE sql STABLE AS $$
  SELECT l.account_id, l.party_id, sum(l.debit), sum(l.credit), sum(l.debit - l.credit)
  FROM core.year_lines(p_year) l WHERE l.party_id IS NOT NULL AND l.effective_date <= p_as_of AND l.kind <> 'closing'
  GROUP BY l.account_id, l.party_id $$;

-- account (or party) ledger with running balance; opening row = balance before p_from
CREATE FUNCTION core.account_ledger(p_year text, p_account int, p_party int, p_from date, p_to date, p_include_closing boolean DEFAULT true)
RETURNS TABLE (seq bigint, effective_date date, entry_id bigint, number bigint, line_no int, debit numeric, credit numeric,
               running_balance numeric, description text) LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT * FROM core.year_lines(p_year) x
    WHERE x.account_id IN (SELECT an.account_id FROM core.account_ancestor an WHERE an.ancestor_id = p_account)
      AND (p_party IS NULL OR x.party_id = p_party) AND x.effective_date <= p_to AND (p_include_closing OR x.kind <> 'closing')),
  o AS (SELECT coalesce(sum(debit - credit), 0) b FROM l WHERE effective_date < p_from)
  SELECT 0::bigint, p_from, NULL::bigint, NULL::bigint, NULL::int, 0::numeric, 0::numeric, o.b, 'opening balance' FROM o
  UNION ALL
  SELECT row_number() OVER w, l.effective_date, l.entry_id, l.number, l.line_no, l.debit, l.credit,
         o.b + sum(l.debit - l.credit) OVER w, coalesce(l.description, l.entry_description)
  FROM l, o WHERE l.effective_date >= p_from
  WINDOW w AS (ORDER BY l.effective_date, coalesce(l.number, l.entry_id), l.entry_id, l.line_no ROWS UNBOUNDED PRECEDING) $$;
