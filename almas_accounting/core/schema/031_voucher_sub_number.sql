-- Almas Shahr accounting — core v0.31: a voucher number is Holoo's (main number, sub-number) pair.
-- Evidence (real FY1405 backup, E31): Holoo numbers a voucher with SANAD.Sanad_Code_C and SANAD.Sanad_Code_C2; its own
-- function dbo.RetSanadCode shows «Sanad_Code_C» or, when Sanad_Code_C2 > 0, «Sanad_Code_C.Sanad_Code_C2» (e.g. 52909.3).
-- FY1404: Sanad_Code_C2 = 0 on all 47,447 vouchers. FY1405: from 1405/04/01 many vouchers share a main number and are
-- told apart by the sub-number; the pair is unique on all 13,951 vouchers. The core therefore keeps both, unique together,
-- orders ledgers by them and shows Holoo's form. Vouchers of the new system have sub-number 0 (gapless main numbers).

ALTER TABLE core.journal_entry
  ADD COLUMN number_sub int NOT NULL DEFAULT 0 CHECK (number_sub >= 0),
  ADD COLUMN number_display text GENERATED ALWAYS AS (CASE WHEN number_sub > 0 THEN number::text || '.' || number_sub ELSE number::text END) STORED,
  ADD CONSTRAINT journal_entry_sub_needs_number CHECK (number_sub = 0 OR number IS NOT NULL);
ALTER TABLE core.journal_entry DROP CONSTRAINT journal_entry_fiscal_year_id_number_key;
ALTER TABLE core.journal_entry ADD CONSTRAINT journal_entry_number_key UNIQUE (fiscal_year_id, number, number_sub);
COMMENT ON COLUMN core.journal_entry.number_sub IS 'Holoo SANAD.Sanad_Code_C2 (0 = none); shown as number.number_sub like dbo.RetSanadCode';

-- «52909.3» / «52909» → (main, sub); NULL when the text is not a voucher number
CREATE FUNCTION core.parse_voucher_number(p text) RETURNS TABLE (main bigint, sub int) LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN ok THEN split_part(t, '.', 1)::bigint END, CASE WHEN ok THEN coalesce(nullif(split_part(t, '.', 2), ''), '0')::int END
  FROM (SELECT t, t ~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' AS ok FROM (SELECT btrim(coalesce(p, '')) t) a) b WHERE ok $$;

-- ---------- reports: order by (number, sub-number), show Holoo's form; new columns are appended (callers unchanged) ----------
DROP FUNCTION core.account_ledger_code(text, text, integer, date, date);
DROP FUNCTION core.account_ledger(text, integer, integer, date, date, boolean);
DROP FUNCTION core.year_lines(text);

CREATE FUNCTION core.year_lines(p_year text)
RETURNS TABLE (entry_id bigint, line_no int, number bigint, effective_date date, kind text, account_id int, party_id int,
               debit numeric, credit numeric, description text, entry_description text, number_sub int, number_display text) LANGUAGE sql STABLE AS $$
  SELECT l.entry_id, l.line_no, e.number, e.effective_date, e.kind, l.account_id, l.party_id, l.debit, l.credit, l.description, e.description,
         e.number_sub, e.number_display
  FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft'
  JOIN core.fiscal_year y ON y.id = e.fiscal_year_id AND y.code = p_year $$;

CREATE FUNCTION core.account_ledger(p_year text, p_account int, p_party int, p_from date, p_to date, p_include_closing boolean DEFAULT true)
RETURNS TABLE (seq bigint, effective_date date, entry_id bigint, number bigint, line_no int, debit numeric, credit numeric,
               running_balance numeric, description text, number_display text) LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT * FROM core.year_lines(p_year) x
    WHERE x.account_id IN (SELECT an.account_id FROM core.account_ancestor an WHERE an.ancestor_id = p_account)
      AND (p_party IS NULL OR x.party_id = p_party) AND x.effective_date <= p_to AND (p_include_closing OR x.kind <> 'closing')),
  o AS (SELECT coalesce(sum(debit - credit), 0) b FROM l WHERE effective_date < p_from)
  SELECT 0::bigint, p_from, NULL::bigint, NULL::bigint, NULL::int, 0::numeric, 0::numeric, o.b, 'opening balance', NULL::text FROM o
  UNION ALL
  SELECT row_number() OVER w, l.effective_date, l.entry_id, l.number, l.line_no, l.debit, l.credit,
         o.b + sum(l.debit - l.credit) OVER w, coalesce(l.description, l.entry_description), l.number_display
  FROM l, o WHERE l.effective_date >= p_from
  WINDOW w AS (ORDER BY l.effective_date, coalesce(l.number, l.entry_id), l.number_sub, l.entry_id, l.line_no ROWS UNBOUNDED PRECEDING) $$;

CREATE FUNCTION core.account_ledger_code(p_year text, p_code text, p_party int, p_from date, p_to date)
RETURNS TABLE (seq bigint, effective_date date, entry_id bigint, number bigint, line_no int, debit numeric, credit numeric, running_balance numeric,
               description text, account_code text, party_name text, number_display text) LANGUAGE sql STABLE AS $$
  SELECT l.seq, l.effective_date, l.entry_id, l.number, l.line_no, l.debit, l.credit, l.running_balance, l.description, a.code, p.name, l.number_display
  FROM core.account_ledger(p_year, (SELECT id FROM core.account WHERE code = p_code), p_party, p_from, p_to, false) l
  JOIN core.journal_line jl ON jl.entry_id = l.entry_id AND jl.line_no = l.line_no JOIN core.account a ON a.id = jl.account_id
  LEFT JOIN core.party p ON p.id = jl.party_id ORDER BY l.seq $$;

-- ---------- lists and lookups ----------
DROP FUNCTION core.journal_list(date, date, text, text, integer);
CREATE FUNCTION core.journal_list(p_from date, p_to date, p_query text DEFAULT NULL, p_source text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS TABLE (entry_id bigint, number bigint, effective_date date, description text, source text, kind text, total numeric, reversed boolean,
               created_by text, number_display text) LANGUAGE sql STABLE AS $$
  SELECT e.id, e.number, e.effective_date, e.description, e.source, e.kind, (SELECT sum(debit) FROM core.journal_line WHERE entry_id = e.id),
         EXISTS (SELECT 1 FROM core.journal_entry r WHERE r.reverses_id = e.id AND r.status <> 'draft'), e.created_by, e.number_display
  FROM core.journal_entry e
  WHERE e.status <> 'draft' AND e.effective_date BETWEEN p_from AND p_to AND (p_source IS NULL OR e.source = p_source)
    AND (p_query IS NULL OR btrim(p_query) = '' OR e.number_display = btrim(p_query) OR e.description ILIKE '%' || p_query || '%'
         OR EXISTS (SELECT 1 FROM core.journal_line l WHERE l.entry_id = e.id AND l.description ILIKE '%' || p_query || '%'))
  ORDER BY e.effective_date DESC, e.number DESC NULLS LAST, e.number_sub DESC, e.id DESC LIMIT least(coalesce(p_limit, 200), 1000) $$;

DROP FUNCTION core.document_voucher(text, text);
CREATE FUNCTION core.document_voucher(p_source text, p_ref text)
RETURNS TABLE (entry_id bigint, number bigint, effective_date date, line_no int, account_code text, account_name text, party_name text,
               debit numeric, credit numeric, description text, number_display text) LANGUAGE sql STABLE AS $$
  SELECT e.id, e.number, e.effective_date, l.line_no, a.code, a.name, p.name, l.debit, l.credit, l.description, e.number_display
  FROM core.document_posting d JOIN core.journal_entry e ON e.id = d.entry_id JOIN core.journal_line l ON l.entry_id = e.id
  JOIN core.account a ON a.id = l.account_id LEFT JOIN core.party p ON p.id = l.party_id
  WHERE d.source = p_source AND d.source_ref = p_ref ORDER BY l.line_no $$;

DROP FUNCTION core.party_settlements(integer);
CREATE FUNCTION core.party_settlements(p_party int)
RETURNS TABLE (settlement_id bigint, account_code text, debit_date date, debit_voucher text, debit_description text, credit_date date, credit_voucher text,
               credit_description text, amount numeric, method text, created_by text, created_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT s.id, a.code, de.effective_date, de.number_display, coalesce(dl.description, de.description), ce.effective_date, ce.number_display,
         coalesce(cl.description, ce.description), s.amount, s.method, s.created_by, s.created_at
  FROM core.settlement_active s JOIN core.account a ON a.id = s.account_id
  JOIN core.journal_entry de ON de.id = s.debit_entry_id JOIN core.journal_line dl ON dl.entry_id = s.debit_entry_id AND dl.line_no = s.debit_line_no
  JOIN core.journal_entry ce ON ce.id = s.credit_entry_id JOIN core.journal_line cl ON cl.entry_id = s.credit_entry_id AND cl.line_no = s.credit_line_no
  WHERE s.party_id = p_party ORDER BY de.effective_date DESC, s.id DESC LIMIT 500 $$;

CREATE OR REPLACE FUNCTION core.global_search(p_query text, p_limit int DEFAULT 8)
RETURNS TABLE (kind text, id text, title text, detail text) LANGUAGE sql STABLE AS $$
  (SELECT 'party', id::text, name, coalesce(national_id, mobile, '') FROM core.party
   WHERE merged_into_id IS NULL AND length(btrim(p_query)) >= 2 AND (name ILIKE '%' || p_query || '%' OR national_id = btrim(p_query) OR mobile = btrim(p_query))
   ORDER BY name LIMIT p_limit)
  UNION ALL
  (SELECT 'item', id::text, name, code FROM core.item WHERE length(btrim(p_query)) >= 2 AND (name ILIKE '%' || p_query || '%' OR code = btrim(p_query)) ORDER BY name LIMIT p_limit)
  UNION ALL
  (SELECT 'entry', e.id::text, 'سند ' || e.number_display, coalesce(e.description, '') || ' — ' || e.effective_date FROM core.journal_entry e
   JOIN core.parse_voucher_number(p_query) v ON v.main = e.number AND (v.sub = e.number_sub OR (position('.' IN p_query) = 0))
   WHERE e.status <> 'draft' ORDER BY e.effective_date DESC, e.number_sub LIMIT p_limit)
  UNION ALL
  (SELECT 'sales_invoice', id::text, 'فاکتور فروش ' || number, invoice_date::text FROM core.sales_invoice
   WHERE btrim(p_query) ~ '^[0-9]{1,12}$' AND number = btrim(p_query)::bigint LIMIT p_limit)
  UNION ALL
  (SELECT 'cheque', id::text, 'چک ' || number, amount::text FROM core.cheque WHERE length(btrim(p_query)) >= 3 AND number = btrim(p_query) LIMIT p_limit) $$;

-- the two jsonb readers get the display form next to the number; the substitution must apply (the migration fails otherwise)
DO $$
DECLARE f text; fn regprocedure; old text; new text;
BEGIN
  FOR fn, old, new IN VALUES
    ('core.party_profile(integer)'::regprocedure, '''number'', e.number,', '''number'', e.number, ''number_display'', e.number_display,'),
    ('core.invoice_detail(text,bigint)'::regprocedure, '''number'', e.number)', '''number'', e.number, ''number_display'', e.number_display)')
  LOOP
    f := pg_get_functiondef(fn);
    IF position(old IN f) = 0 THEN RAISE EXCEPTION 'core 031: % no longer contains %', fn, old; END IF;
    EXECUTE replace(f, old, new);
  END LOOP;
END $$;
