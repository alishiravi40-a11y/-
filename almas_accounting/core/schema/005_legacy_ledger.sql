-- Almas Shahr accounting — core v0.5: Holoo ledger migration under D-03 (parties as sub-ledger on control accounts).
-- Written by almas_accounting/migration/holoo_ledger.py; proven by migration/tests and a full parity run on FY1404.

-- Holoo account → core account (+ party for person accounts). Nothing is lost: every Holoo code is mapped or recorded as dropped.
CREATE TABLE core.legacy_account_map (
  source_system text NOT NULL DEFAULT 'holoo', source_db text NOT NULL, legacy_code text NOT NULL, legacy_name text,
  account_id int REFERENCES core.account, party_id int REFERENCES core.party,
  kind text NOT NULL CHECK (kind IN ('same_code', 'person_control', 'dropped_unused')),
  first_seen_run text, last_seen_run text,
  PRIMARY KEY (source_system, source_db, legacy_code),
  CHECK ((kind = 'dropped_unused') = (account_id IS NULL)),
  CHECK ((kind = 'person_control') = (party_id IS NOT NULL)));

-- Holoo voucher → core journal entry. A changed voucher in a newer backup is superseded (reversal + new entry);
-- a voucher removed in the source is reversed. Posted entries are never edited (W-05).
CREATE TABLE core.legacy_entry_map (
  source_system text NOT NULL DEFAULT 'holoo', source_db text NOT NULL, sanad_code int NOT NULL, entry_id bigint REFERENCES core.journal_entry,
  voucher_hash text NOT NULL, status text NOT NULL CHECK (status IN ('current', 'superseded', 'removed_in_source', 'skipped_no_visible_lines')),
  reversal_entry_id bigint REFERENCES core.journal_entry, first_seen_run text, last_seen_run text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX legacy_entry_map_current ON core.legacy_entry_map (source_system, source_db, sanad_code) WHERE status IN ('current', 'skipped_no_visible_lines');
CREATE INDEX legacy_entry_map_entry ON core.legacy_entry_map (entry_id);

-- trial balance per account and party (sub-ledger view)
CREATE VIEW core.trial_balance_party AS
SELECT y.code AS fiscal_year, a.code AS account_code, a.name AS account_name, l.party_id,
       SUM(l.debit) AS debit, SUM(l.credit) AS credit, SUM(l.debit - l.credit) AS balance
FROM core.journal_line l JOIN core.journal_entry e ON e.id = l.entry_id AND e.status <> 'draft'
JOIN core.fiscal_year y ON y.id = e.fiscal_year_id JOIN core.account a ON a.id = l.account_id
GROUP BY y.code, a.code, a.name, l.party_id;
