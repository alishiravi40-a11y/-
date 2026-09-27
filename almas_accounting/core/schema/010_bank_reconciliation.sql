-- Almas Shahr accounting — core v0.10: bank reconciliation («مغایرت‌گیری بانکی»).
-- The 1404 Holoo backup holds no reconciliation data at all (no table; E20): which bank line corresponds to which book
-- line was never recorded. This is a new capability, built on the imported bank statement (core.bank_statement_line,
-- 004) and the ledger lines of the bank's GL account (company_bank_account.gl_account_id).
--
-- A reconciliation GROUP ties n statement lines to m book lines of the same bank account with equal net amount
-- (deposit − withdrawal = debit − credit). Groups are append-only; a wrong group is undone with a reason. Every line is
-- in at most one live group. core.bank_reconciliation(account, from, to) proves the period: the change of the
-- difference (bank − book) must be fully explained by the lines not yet reconciled; «unexplained» must be zero.

INSERT INTO core.permission (code, description) VALUES
  ('bank.reconcile', 'create bank reconciliation groups (manual or automatic run)'),
  ('bank.unreconcile', 'undo a bank reconciliation group (with reason)');
INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('bank_recon_date_window_days', '3', NULL, '^[0-9]{1,2}$', 'E20');

CREATE TABLE core.bank_recon_group (
  id bigserial PRIMARY KEY, company_bank_account_id int NOT NULL REFERENCES core.company_bank_account,
  method text NOT NULL CHECK (method IN ('exact', 'window', 'same_day_sum', 'manual')),
  statement_net numeric(20,0) NOT NULL, book_net numeric(20,0) NOT NULL, CHECK (statement_net = book_net),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE core.bank_recon_statement (
  group_id bigint NOT NULL REFERENCES core.bank_recon_group, statement_line_id bigint NOT NULL REFERENCES core.bank_statement_line,
  PRIMARY KEY (group_id, statement_line_id));
CREATE TABLE core.bank_recon_book (
  group_id bigint NOT NULL REFERENCES core.bank_recon_group, entry_id bigint NOT NULL, line_no int NOT NULL,
  PRIMARY KEY (group_id, entry_id, line_no), FOREIGN KEY (entry_id, line_no) REFERENCES core.journal_line (entry_id, line_no));
CREATE INDEX bank_recon_statement_line ON core.bank_recon_statement (statement_line_id);
CREATE INDEX bank_recon_book_line ON core.bank_recon_book (entry_id, line_no);
CREATE TABLE core.bank_recon_undo (
  group_id bigint PRIMARY KEY REFERENCES core.bank_recon_group, undone_by text NOT NULL, undone_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3));
CREATE TRIGGER bank_recon_group_immutable BEFORE UPDATE OR DELETE ON core.bank_recon_group FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER bank_recon_statement_immutable BEFORE UPDATE OR DELETE ON core.bank_recon_statement FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER bank_recon_book_immutable BEFORE UPDATE OR DELETE ON core.bank_recon_book FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TRIGGER bank_recon_undo_immutable BEFORE UPDATE OR DELETE ON core.bank_recon_undo FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE VIEW core.bank_recon_live AS
SELECT g.* FROM core.bank_recon_group g WHERE NOT EXISTS (SELECT 1 FROM core.bank_recon_undo u WHERE u.group_id = g.id);

-- book lines of a bank account: the lines of posted entries on its GL account
CREATE VIEW core.bank_book_line AS
SELECT b.id AS company_bank_account_id, l.entry_id, l.line_no, e.effective_date, l.debit, l.credit, l.debit - l.credit AS net,
       coalesce(l.description, e.description) AS description,
       (SELECT r.group_id FROM core.bank_recon_book r JOIN core.bank_recon_live g ON g.id = r.group_id
        WHERE r.entry_id = l.entry_id AND r.line_no = l.line_no) AS group_id
FROM core.company_bank_account b JOIN core.journal_line l ON l.account_id = b.gl_account_id
JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft';

CREATE VIEW core.bank_statement_recon AS
SELECT s.id AS statement_line_id, s.company_bank_account_id, s.value_date, s.value_time, s.deposit, s.withdrawal,
       s.deposit - s.withdrawal AS net, s.balance, s.doc_no, s.description,
       (SELECT r.group_id FROM core.bank_recon_statement r JOIN core.bank_recon_live g ON g.id = r.group_id
        WHERE r.statement_line_id = s.id) AS group_id
FROM core.bank_statement_line s;

-- create one group; p_book = [[entry_id, line_no], ...]
CREATE FUNCTION core.reconcile(p_account int, p_statement bigint[], p_book jsonb, p_method text, p_user text, p_note text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE gl int; sn numeric; bn numeric; gid bigint; nb int; ns int;
BEGIN
  PERFORM core.require_permission(p_user, 'bank.reconcile');
  PERFORM pg_advisory_xact_lock(hashtext('bank_recon'), p_account);
  SELECT gl_account_id INTO gl FROM core.company_bank_account WHERE id = p_account;
  IF gl IS NULL THEN RAISE EXCEPTION 'bank account % has no GL account', p_account; END IF;
  IF coalesce(array_length(p_statement, 1), 0) = 0 OR jsonb_array_length(coalesce(p_book, '[]')) = 0 THEN
    RAISE EXCEPTION 'a group needs at least one statement line and one book line'; END IF;
  SELECT count(*), sum(net) INTO ns, sn FROM core.bank_statement_recon WHERE statement_line_id = ANY (p_statement) AND company_bank_account_id = p_account;
  IF ns <> array_length(p_statement, 1) THEN RAISE EXCEPTION 'statement lines must belong to bank account %', p_account; END IF;
  IF EXISTS (SELECT 1 FROM core.bank_statement_recon WHERE statement_line_id = ANY (p_statement) AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a statement line is already reconciled'; END IF;
  SELECT count(*), sum(b.net) INTO nb, bn FROM jsonb_array_elements(p_book) x
    JOIN core.bank_book_line b ON b.company_bank_account_id = p_account AND b.entry_id = (x->>0)::bigint AND b.line_no = (x->>1)::int;
  IF nb <> jsonb_array_length(p_book) THEN RAISE EXCEPTION 'book lines must be posted lines on the GL account of bank account %', p_account; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_book) x JOIN core.bank_book_line b ON b.company_bank_account_id = p_account
             AND b.entry_id = (x->>0)::bigint AND b.line_no = (x->>1)::int WHERE b.group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a book line is already reconciled'; END IF;
  IF sn <> bn THEN RAISE EXCEPTION 'statement net % differs from book net %', sn, bn; END IF;
  INSERT INTO core.bank_recon_group (company_bank_account_id, method, statement_net, book_net, created_by, note)
  VALUES (p_account, p_method, sn, bn, p_user, p_note) RETURNING id INTO gid;
  INSERT INTO core.bank_recon_statement SELECT gid, unnest(p_statement);
  INSERT INTO core.bank_recon_book SELECT gid, (x->>0)::bigint, (x->>1)::int FROM jsonb_array_elements(p_book) x;
  RETURN gid;
END $$;

CREATE FUNCTION core.unreconcile(p_group bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'bank.unreconcile');
  INSERT INTO core.bank_recon_undo (group_id, undone_by, reason) VALUES (p_group, p_user, p_reason);
END $$;

-- reconciliation statement of a bank account for [p_from, p_to]
CREATE FUNCTION core.bank_reconciliation(p_account int, p_from date, p_to date)
RETURNS TABLE (statement_opening numeric, statement_closing numeric, book_opening numeric, book_closing numeric,
               in_bank_not_in_book numeric, in_book_not_in_bank numeric, reconciled_across_period numeric,
               unreconciled_statement_lines bigint, unreconciled_book_lines bigint, unexplained numeric) LANGUAGE sql STABLE AS $$
  WITH s AS (SELECT * FROM core.bank_statement_recon WHERE company_bank_account_id = p_account),
  sp AS (SELECT * FROM s WHERE value_date BETWEEN p_from AND p_to),
  b AS (SELECT * FROM core.bank_book_line WHERE company_bank_account_id = p_account),
  bp AS (SELECT * FROM b WHERE effective_date BETWEEN p_from AND p_to),
  -- groups with any line outside the period
  cross_g AS (
    SELECT r.group_id FROM core.bank_recon_statement r JOIN s ON s.statement_line_id = r.statement_line_id
      WHERE s.group_id = r.group_id AND s.value_date NOT BETWEEN p_from AND p_to
    UNION SELECT r.group_id FROM core.bank_recon_book r JOIN b ON b.entry_id = r.entry_id AND b.line_no = r.line_no
      WHERE b.group_id = r.group_id AND b.effective_date NOT BETWEEN p_from AND p_to),
  first_last AS (
    SELECT (SELECT balance - deposit + withdrawal FROM sp ORDER BY value_date, value_time, statement_line_id LIMIT 1) so,
           (SELECT balance FROM sp ORDER BY value_date DESC, value_time DESC, statement_line_id DESC LIMIT 1) sc),
  k AS (
    SELECT fl.so, fl.sc,
      (SELECT coalesce(sum(net), 0) FROM b WHERE effective_date < p_from) bo,
      (SELECT coalesce(sum(net), 0) FROM b WHERE effective_date <= p_to) bc,
      (SELECT coalesce(sum(net), 0) FROM sp WHERE group_id IS NULL) us,
      (SELECT coalesce(sum(net), 0) FROM bp WHERE group_id IS NULL) ub,
      (SELECT coalesce(sum(net), 0) FROM sp WHERE group_id IN (SELECT group_id FROM cross_g))
        - (SELECT coalesce(sum(net), 0) FROM bp WHERE group_id IN (SELECT group_id FROM cross_g)) cr,
      (SELECT count(*) FROM sp WHERE group_id IS NULL) nus, (SELECT count(*) FROM bp WHERE group_id IS NULL) nub
    FROM first_last fl)
  SELECT so, sc, bo, bc, us, ub, cr, nus, nub, ((sc - bc) - (so - bo)) - (us - ub) - cr FROM k $$;
