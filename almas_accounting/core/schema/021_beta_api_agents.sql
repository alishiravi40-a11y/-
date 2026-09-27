-- Almas Shahr accounting — core v0.21: Refah Bank Beta services (API evidence) + Almas's agent network.
-- Design: docs/BETA_API_FA.md (gap analysis of BetaApiDoc revision 1.3, 1402/01). Proven by migration/tests/test_beta_api_agents.py.
--
-- Two layers that are never mixed:
--   1. BANK LAYER — what the Beta system says (orders, installments, statuses, credit). Every API call is stored as
--      immutable EVIDENCE (beta_api_call) and parsed into immutable observations. The bank is NOT the accounting source of
--      truth: money exists in Almas only as a bank-statement line / receipt (004), accounting only as a voucher.
--   2. ALMAS LAYER — agents who sell under Almas's Beta permit, the sale request that drives the Beta workflow, who owns
--      each contract, what each agent is entitled to and what was paid to them, with allocation (lineage).
-- Nothing here guesses a formula: the agent share, Almas's fee, the bank's fee and when each is recognised are OPEN owner /
-- accountant decisions (D-14, D-22). Entitlements are recorded explicitly with their basis; nothing is computed.
-- The API document is from 1402: nothing may reach Production until the current API version is verified (D-23):
-- setting beta_api_mode starts 'disabled', and only a person (settings.change) can change it.

-- ============ Permissions and settings ============
INSERT INTO core.permission VALUES
  ('beta.api_call',     'call Beta services (inquiry, lists, installments) and run the sale workflow for any agent'),
  ('beta.sale_manage',  'create and manage Beta sale requests for any agent (central staff)'),
  ('beta.order_change', 'delete or edit an order / installment at the Beta system (irreversible at the bank; people only)'),
  ('agent.workspace',   'agent workspace: own customers, own cases, own sale requests only'),
  ('agent.manage',      'create agents, bind users to agents, assign contracts to agents'),
  ('agent.entitlement', 'record / reverse what an agent is entitled to for a sale or a collection'),
  ('agent.settle',      'record / reverse a payment to an agent with its allocation (people only)');

INSERT INTO core.setting (key, value, allowed, pattern, decision) VALUES
  ('beta_api_mode', 'disabled', '{disabled,simulated,production}', NULL, 'D-23'),
  ('beta_api_revision', '1.3 (1402/01) — not verified for today', NULL, '^.{3,120}$', 'D-23'),
  ('beta_deposit_expected_days', '5', NULL, '^[0-9]{1,3}$', 'BA-05'),
  ('agent_share_rule', 'undecided', '{undecided}', NULL, 'D-22');

-- ============ Jalali calendar (pure SQL; the Beta API speaks Jalali months) ============
-- day of March on which Farvardin 1 of Jalali year jy falls (jalaali algorithm, 33-year cycles with breaks)
CREATE FUNCTION core.jalali_march(jy int) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE breaks int[] := '{-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178}';
        gy int := jy + 621; leap_j int := -14; jp int := breaks[1]; jm int; jump int := 0; n int; leap_g int;
BEGIN
  FOR i IN 2 .. array_length(breaks, 1) LOOP
    jm := breaks[i]; jump := jm - jp;
    EXIT WHEN jy < jm;
    leap_j := leap_j + (jump / 33) * 8 + (jump % 33) / 4; jp := jm;
  END LOOP;
  n := jy - jp;
  leap_j := leap_j + (n / 33) * 8 + ((n % 33) + 3) / 4;
  IF jump % 33 = 4 AND jump - n = 4 THEN leap_j := leap_j + 1; END IF;
  leap_g := gy / 4 - ((gy / 100 + 1) * 3) / 4 - 150;
  RETURN 20 + leap_j - leap_g;
END $$;

CREATE FUNCTION core.jalali_start(jy int) RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT make_date(jy + 621, 3, core.jalali_march(jy)) $$;

-- Gregorian date → Jalali 'YYYY/MM/DD'
CREATE FUNCTION core.jalali(d date) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE jy int := extract(year FROM d)::int - 621; k int;
BEGIN
  IF d < core.jalali_start(jy) THEN jy := jy - 1; END IF;
  k := d - core.jalali_start(jy);
  IF k < 186 THEN RETURN format('%s/%s/%s', jy, lpad((1 + k / 31)::text, 2, '0'), lpad((1 + k % 31)::text, 2, '0')); END IF;
  k := k - 186;
  RETURN format('%s/%s/%s', jy, lpad((7 + k / 30)::text, 2, '0'), lpad((1 + k % 30)::text, 2, '0'));
END $$;

CREATE FUNCTION core.jalali_ym(d date) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT left(core.jalali(d), 7) $$;

-- Jalali 'YYYY/MM/DD' (or YYYY-MM-DD, Persian digits allowed) → Gregorian date
CREATE FUNCTION core.jalali_to_date(p text) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := translate(p, '۰۱۲۳۴۵۶۷۸۹', '0123456789'); m text[];
BEGIN
  m := regexp_match(s, '^\s*(1[2-5][0-9]{2})[/-]([0-9]{1,2})[/-]([0-9]{1,2})');
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN core.jalali_start(m[1]::int)
         + CASE WHEN m[2]::int <= 6 THEN (m[2]::int - 1) * 31 ELSE 186 + (m[2]::int - 7) * 30 END + m[3]::int - 1;
END $$;

-- a date as the Beta API may send it: ISO Gregorian (DateTime) or Jalali text — the format is not fixed by the document (U-B4)
CREATE FUNCTION core.beta_date(p text) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p IS NULL OR btrim(p) = '' THEN NULL
              WHEN p ~ '^\s*(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}' THEN left(btrim(p), 10)::date
              ELSE core.jalali_to_date(p) END $$;

-- a JSON field by name in camelCase or PascalCase (the document shows both; U-B3)
CREATE FUNCTION core.jf(j jsonb, k text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(j ->> k, j ->> (upper(left(k, 1)) || substr(k, 2)), j ->> (lower(left(k, 1)) || substr(k, 2))) $$;

-- ============ Almas agent network (ALMAS LAYER) ============
CREATE TABLE core.sales_agent (
  id serial PRIMARY KEY, code text UNIQUE NOT NULL, title text NOT NULL, party_id int REFERENCES core.party,
  province text, city text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
COMMENT ON TABLE core.sales_agent IS 'agent who sells on installments under Almas''s Beta permit; money reaches Almas, never the agent directly';

-- a user bound to an agent works ONLY in the agent workspace (no central accounting)
CREATE TABLE core.sales_agent_user (
  username text PRIMARY KEY REFERENCES core.app_user, agent_id int NOT NULL REFERENCES core.sales_agent,
  bound_by text NOT NULL, bound_at timestamptz NOT NULL DEFAULT now());

-- the permissions an agent user may ever hold
CREATE FUNCTION core.agent_permission_allowed(p_perm text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_perm IN ('agent.workspace') $$;

CREATE FUNCTION core.trg_agent_user_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_permission' THEN
    IF EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = NEW.username) AND NOT core.agent_permission_allowed(NEW.permission) THEN
      RAISE EXCEPTION 'agent user % may not hold central permission %', NEW.username, NEW.permission USING ERRCODE = 'insufficient_privilege'; END IF;
  ELSIF EXISTS (SELECT 1 FROM core.user_permission WHERE username = NEW.username AND NOT core.agent_permission_allowed(permission)) THEN
    RAISE EXCEPTION 'user % holds central permissions; an agent user must be a separate account', NEW.username USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_user_central_permission BEFORE INSERT OR UPDATE ON core.user_permission FOR EACH ROW EXECUTE FUNCTION core.trg_agent_user_permission();
CREATE TRIGGER agent_user_bind BEFORE INSERT OR UPDATE ON core.sales_agent_user FOR EACH ROW EXECUTE FUNCTION core.trg_agent_user_permission();

CREATE FUNCTION core.agent_of(p_user text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT a.agent_id FROM core.sales_agent_user a JOIN core.app_user u USING (username) JOIN core.sales_agent g ON g.id = a.agent_id
  WHERE a.username = p_user AND u.active $$;

-- the agent's written agreement, kept as evidence; NO formula is derived from it (D-22)
CREATE TABLE core.agent_agreement (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, effective_from date NOT NULL,
  terms_summary text NOT NULL, evidence_ref text NOT NULL, recorded_by text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER agent_agreement_immutable BEFORE UPDATE OR DELETE ON core.agent_agreement FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- ============ Beta evidence (BANK LAYER) ============
-- status / error codes exactly as documented in revision 1.3 (4455 has two meanings depending on the service)
CREATE TABLE core.beta_status_code (
  id serial PRIMARY KEY, code int NOT NULL, meaning_fa text NOT NULL,
  category text NOT NULL CHECK (category IN ('ok', 'auth', 'acceptor', 'customer', 'input', 'limit', 'state', 'system')),
  endpoints text[] NOT NULL, note text, UNIQUE (code, meaning_fa));

INSERT INTO core.beta_status_code (code, meaning_fa, category, endpoints, note) VALUES
  (200,  'موفق (با داده یا بدون داده)', 'ok', '{credit_inquiry,otp_request,consume,order_list,order_installments,order_delete,installment_delete,edit_request,edit,order_by_request_id,valid_months}', NULL),
  (4403, 'api-key را به درستی وارد کنید', 'auth', '{credit_inquiry,otp_request,consume,order_list,order_installments,order_delete,installment_delete,edit_request,edit}', NULL),
  (4404, 'دسترسی محدود (این فروش متعلق به این پذیرنده نیست)', 'acceptor', '{otp_request,consume,edit_request,edit}', NULL),
  (4406, 'تکراری است', 'state', '{consume}', 'duplicate consume: resolve by order/{requestId}, never by a new sale'),
  (4440, 'اطلاعات ورودی معتبر نیست (دلیل در متن خطا)', 'input', '{otp_request,consume}', NULL),
  (4441, 'اطلاعات مبلغ یا تعداد اقساط اشتباه است', 'input', '{otp_request,consume}', NULL),
  (4442, 'عنوان اشتباه است', 'input', '{otp_request,consume}', NULL),
  (4443, 'کد ملی اشتباه است', 'input', '{credit_inquiry,otp_request,consume}', NULL),
  (4444, 'رمز یکبار مصرف برای شما ارسال شده است، لطفاً کمی منتظر بمانید', 'state', '{otp_request,edit_request,edit}', 'OTP valid 2 minutes; no new OTP meanwhile'),
  (4445, 'تاریخ برداشت معتبر نیست', 'input', '{edit_request,edit}', NULL),
  (4446, 'رمز یکبار مصرف اشتباه است', 'state', '{consume,edit}', 'OTP is bound to the request data'),
  (4447, 'اطلاعات سال‌ماه جهت دریافت گزارش معتبر نیست', 'input', '{order_list}', 'yearMonth = YYYYMM'),
  (4450, 'مشتری اجازه‌نامه استعلام و کسر اقساط را امضا نکرده است', 'customer', '{credit_inquiry,otp_request,consume}', NULL),
  (4451, 'مشتری پروفایل خود را تکمیل نکرده است', 'customer', '{credit_inquiry,otp_request,consume}', NULL),
  (4452, 'مشتری اعتبارسنجی نشده یا نیاز به اعتبارسنجی مجدد دارد', 'customer', '{credit_inquiry,otp_request,consume}', NULL),
  (4453, 'مشتری اعتبار ندارد', 'customer', '{consume}', NULL),
  (4455, 'مشتری با این مشخصات یافت نشد', 'customer', '{credit_inquiry,edit}', NULL),
  (4455, 'مشتری در طرح دیگری ثبت‌نام کرده و تا پایان آن طرح امکان شرکت در سایر طرح‌ها را ندارد', 'customer', '{otp_request,consume}', 'same code, other meaning'),
  (4460, 'شناسه فروش نامعتبر است', 'input', '{order_installments,order_delete,installment_delete,edit_request,edit}', NULL),
  (4461, 'مبلغ درخواستی بیشتر از اعتبار است', 'limit', '{consume}', NULL),
  (4462, 'امکان ایجاد اقساط بیشتر از ۳۶ ماه وجود ندارد', 'limit', '{otp_request,consume}', NULL),
  (4463, 'امکان ثبت بیش از ۸ خرید در ماه برای یک مشتری از طرف یک پذیرنده نیست', 'limit', '{consume}', NULL),
  (4464, 'به دلیل پردازش رکوردهای اقساط امکان حذف وجود ندارد', 'state', '{order_delete,installment_delete}', NULL),
  (4466, 'به دلیل پردازش رکورد قسط امکان ویرایش وجود ندارد', 'state', '{edit_request,edit}', NULL),
  (4468, 'شناسه قسط نامعتبر است', 'input', '{installment_delete}', NULL),
  (4470, 'امکان استفاده از سرویس‌های api برای این پذیرنده وجود ندارد', 'acceptor', '{otp_request,consume,order_list,order_installments,order_delete,installment_delete,edit_request,edit}', NULL),
  (4471, 'پذیرنده با این مشخصات یافت نشد', 'acceptor', '{otp_request,consume,order_delete,installment_delete,edit_request,edit}', NULL),
  (4473, 'پذیرنده غیرفعال است', 'acceptor', '{otp_request,consume,order_list,order_installments,order_delete,installment_delete,edit_request,edit}', NULL),
  (4474, 'پذیرنده مجاز به ثبت فروش / عملیات نیست', 'acceptor', '{otp_request,consume,order_delete,installment_delete,edit_request,edit}', NULL),
  (4775, 'پذیرنده تفاهم‌نامه فعالی ندارد', 'acceptor', '{otp_request,consume}', 'printed 4775 in the document; probably 4475 (U-B6)'),
  (4476, 'کارمزد شما به درستی تعریف نشده است؛ به مدیریت امور شعب استان مراجعه کنید', 'acceptor', '{otp_request,consume,order_delete,installment_delete,edit_request,edit}', 'proves an acceptor fee exists at the bank; amount/formula not in the API'),
  (400,  'خطای اعتبارسنجی (HTTP)', 'system', '{*}', 'HTTP status, not business status'),
  (403,  'مجوز دسترسی به این بخش را ندارید (HTTP)', 'auth', '{*}', 'HTTP status'),
  (500,  'خطای سیستمی (HTTP)', 'system', '{*}', 'HTTP status');

CREATE FUNCTION core.beta_status_meaning(p_endpoint text, p_code int) RETURNS core.beta_status_code LANGUAGE sql STABLE AS $$
  SELECT * FROM core.beta_status_code WHERE code = p_code AND (p_endpoint = ANY (endpoints) OR '*' = ANY (endpoints))
  ORDER BY ('*' = ANY (endpoints)), id LIMIT 1 $$;

-- the sale request: Almas's internal record that drives inquiry → OTP → consume. request_id is the idempotency key sent
-- to Beta as requestId; it is generated ONCE and never changes, so a retried consume can always be resolved.
CREATE TABLE core.beta_sale_request (
  id bigserial PRIMARY KEY, request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  scheme_id int NOT NULL REFERENCES core.beta_scheme, agent_id int REFERENCES core.sales_agent,     -- NULL = Almas's own sale
  national_id text NOT NULL CHECK (core.valid_national_id(national_id)), party_id int REFERENCES core.party, customer_name text,
  title text NOT NULL CHECK (btrim(title) <> ''), amount numeric(20,0) NOT NULL CHECK (amount > 0),
  installment_count int NOT NULL CHECK (installment_count BETWEEN 1 AND 36),                  -- 4462: at most 36
  start_year_month text NOT NULL CHECK (start_year_month ~ '^1[3-5][0-9]{2}/(0[1-9]|1[0-2])$'),
  internal_ref text,                                                                          -- Almas invoice / internal sale
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'checked', 'otp_sent', 'unknown_outcome', 'consumed', 'contracted', 'failed', 'abandoned')),
  checked_credit numeric(20,0), checked_at timestamptz,
  otp_sent_at timestamptz, otp_expires_at timestamptz, otp_fingerprint text,
  beta_order_id bigint, contract_id bigint REFERENCES core.installment_contract,
  last_call_id bigint, last_status int, failure text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz);
CREATE INDEX beta_sale_request_customer ON core.beta_sale_request (scheme_id, national_id);

-- the data an OTP is bound to (document: changing any field invalidates the OTP)
CREATE FUNCTION core.beta_sale_fingerprint(r core.beta_sale_request) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT md5(concat_ws('|', r.national_id, r.title, r.amount, r.installment_count, r.start_year_month)) $$;

CREATE FUNCTION core.trg_sale_request_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'sale requests are never deleted; abandon instead'; END IF;
  IF (NEW.request_id, NEW.scheme_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.request_id, OLD.scheme_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'sale request % identity is immutable', OLD.id; END IF;
  IF OLD.status IN ('otp_sent', 'unknown_outcome', 'consumed', 'contracted')
     AND (NEW.national_id, NEW.title, NEW.amount, NEW.installment_count, NEW.start_year_month, NEW.agent_id)
         IS DISTINCT FROM (OLD.national_id, OLD.title, OLD.amount, OLD.installment_count, OLD.start_year_month, OLD.agent_id)
     AND NOT (OLD.status = 'otp_sent' AND NEW.status IN ('draft', 'checked')) THEN
    RAISE EXCEPTION 'sale request % is % at the bank; its data cannot change', OLD.id, OLD.status; END IF;
  IF OLD.status IN ('contracted', 'abandoned') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'sale request % is %', OLD.id, OLD.status; END IF;
  IF OLD.beta_order_id IS NOT NULL AND NEW.beta_order_id IS DISTINCT FROM OLD.beta_order_id THEN
    RAISE EXCEPTION 'sale request % already has Beta order %', OLD.id, OLD.beta_order_id; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER sale_request_rules BEFORE UPDATE OR DELETE ON core.beta_sale_request FOR EACH ROW EXECUTE FUNCTION core.trg_sale_request_rules();

-- every call to the Beta API: request (OTP masked, no secrets), raw response, outcome. Immutable evidence.
CREATE TABLE core.beta_api_call (
  id bigserial PRIMARY KEY, scheme_id int NOT NULL REFERENCES core.beta_scheme,
  environment text NOT NULL CHECK (environment IN ('simulated', 'production')), api_revision text NOT NULL,
  endpoint text NOT NULL CHECK (endpoint IN ('credit_inquiry', 'otp_request', 'consume', 'order_list', 'order_installments', 'order_delete',
                                             'installment_delete', 'edit_request', 'edit', 'order_by_request_id', 'valid_months')),
  http_method text NOT NULL, path text NOT NULL, request_body jsonb, sale_request_id bigint REFERENCES core.beta_sale_request,
  order_ref bigint, http_status int, business_status int, message text, response jsonb, transport_error text,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'business_error', 'http_error', 'no_response')),
  started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  called_by text NOT NULL REFERENCES core.app_user, response_sha256 text,
  CHECK (request_body IS NULL OR NOT (request_body ? 'otp') OR request_body ->> 'otp' = '***'),
  CHECK (NOT (request_body ?| array['apikey', 'client_secret', 'access_token', 'Authorization'])));
CREATE TRIGGER beta_api_call_immutable BEFORE UPDATE OR DELETE ON core.beta_api_call FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
COMMENT ON TABLE core.beta_api_call IS 'immutable evidence of every Beta API call (bank layer); never the accounting source of truth';

-- official orders known to Almas (identity only) and what each call observed about them
CREATE TABLE core.beta_order (
  scheme_id int NOT NULL REFERENCES core.beta_scheme, beta_order_id bigint NOT NULL, request_id uuid, national_id text,
  first_call_id bigint NOT NULL REFERENCES core.beta_api_call, PRIMARY KEY (scheme_id, beta_order_id), UNIQUE (scheme_id, request_id));
CREATE TABLE core.beta_order_observation (
  id bigserial PRIMARY KEY, call_id bigint NOT NULL REFERENCES core.beta_api_call, scheme_id int NOT NULL, beta_order_id bigint NOT NULL,
  present boolean NOT NULL,                                   -- false: the bank answered 4460 (invalid order id) for it
  title text, amount numeric(20,0), national_id text, description text, project_type int, list_year_month text,
  observed_at timestamptz NOT NULL);
CREATE TRIGGER beta_order_observation_immutable BEFORE UPDATE OR DELETE ON core.beta_order_observation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE TABLE core.beta_installment_observation (
  id bigserial PRIMARY KEY, call_id bigint NOT NULL REFERENCES core.beta_api_call, scheme_id int NOT NULL, beta_order_id bigint NOT NULL,
  beta_installment_id bigint NOT NULL, amount numeric(20,0), overdue_raw text, overdue_date date, settle_raw text, settle_date date,
  is_settled boolean, status_raw text, status_title text, is_deleted boolean, observed_at timestamptz NOT NULL);
CREATE TRIGGER beta_installment_observation_immutable BEFORE UPDATE OR DELETE ON core.beta_installment_observation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE INDEX beta_installment_observation_key ON core.beta_installment_observation (scheme_id, beta_installment_id, observed_at DESC);
CREATE TABLE core.beta_credit_observation (
  id bigserial PRIMARY KEY, call_id bigint NOT NULL REFERENCES core.beta_api_call, national_id text NOT NULL, credit numeric(20,0) NOT NULL,
  observed_at timestamptz NOT NULL);
CREATE TABLE core.beta_ingest_error (call_id bigint PRIMARY KEY REFERENCES core.beta_api_call, error text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE core.beta_valid_month_observation (
  call_id bigint PRIMARY KEY REFERENCES core.beta_api_call, scheme_id int NOT NULL, months text[] NOT NULL, observed_at timestamptz NOT NULL);

-- installment status names: the document lists Created, InProcess, Success, Rejected WITHOUT numeric values. The numbers
-- below are the C# default (0..3) — an inference, flagged unverified until a real response confirms it (U-B2).
CREATE TABLE core.beta_installment_status_map (
  raw text PRIMARY KEY, name text NOT NULL CHECK (name IN ('Created', 'InProcess', 'Success', 'Rejected')), verified boolean NOT NULL, basis text NOT NULL);
INSERT INTO core.beta_installment_status_map VALUES
  ('Created', 'Created', true, 'document name'), ('InProcess', 'InProcess', true, 'document name'),
  ('Success', 'Success', true, 'document name'), ('Rejected', 'Rejected', true, 'document name'),
  ('0', 'Created', false, 'C# enum default order (U-B2)'), ('1', 'InProcess', false, 'C# enum default order (U-B2)'),
  ('2', 'Success', false, 'C# enum default order (U-B2)'), ('3', 'Rejected', false, 'C# enum default order (U-B2)');

CREATE VIEW core.beta_installment_latest AS
SELECT DISTINCT ON (o.scheme_id, o.beta_installment_id) o.*, m.name AS status_name, m.verified AS status_verified
FROM core.beta_installment_observation o LEFT JOIN core.beta_installment_status_map m ON m.raw = o.status_raw
ORDER BY o.scheme_id, o.beta_installment_id, o.observed_at DESC, o.id DESC;

-- the latest installments answer per order (only the latest call counts: an installment missing from it is not "live")
CREATE VIEW core.beta_order_latest AS
WITH lo AS (SELECT DISTINCT ON (scheme_id, beta_order_id) * FROM core.beta_order_observation
            ORDER BY scheme_id, beta_order_id, observed_at DESC, id DESC),
     li AS (SELECT DISTINCT ON (c.scheme_id, c.order_ref) c.scheme_id, c.order_ref, c.id AS call_id, c.business_status, c.finished_at
            FROM core.beta_api_call c WHERE c.endpoint = 'order_installments' AND c.outcome IN ('ok', 'business_error')
            ORDER BY c.scheme_id, c.order_ref, c.finished_at DESC, c.id DESC)
SELECT o.scheme_id, o.beta_order_id, o.request_id, coalesce(lo.national_id, o.national_id) AS national_id, lo.title, lo.amount,
       lo.project_type, lo.present AND coalesce(li.business_status, 200) <> 4460 AS present, li.call_id AS installments_call_id,
       (SELECT count(*) FROM core.beta_installment_observation x WHERE x.call_id = li.call_id AND NOT coalesce(x.is_deleted, false)) AS live_installments,
       (SELECT coalesce(sum(x.amount), 0) FROM core.beta_installment_observation x WHERE x.call_id = li.call_id AND NOT coalesce(x.is_deleted, false)) AS live_amount,
       (SELECT count(*) FROM core.beta_installment_observation x WHERE x.call_id = li.call_id AND x.is_settled) AS settled_count,
       (SELECT coalesce(sum(x.amount), 0) FROM core.beta_installment_observation x WHERE x.call_id = li.call_id AND x.is_settled) AS settled_amount,
       (SELECT max(x.settle_date) FROM core.beta_installment_observation x WHERE x.call_id = li.call_id AND x.is_settled) AS last_settle_date
FROM core.beta_order o LEFT JOIN lo ON lo.scheme_id = o.scheme_id AND lo.beta_order_id = o.beta_order_id
LEFT JOIN li ON li.scheme_id = o.scheme_id AND li.order_ref = o.beta_order_id;

-- ============ Links between the layers ============
ALTER TABLE core.installment_contract
  ADD COLUMN beta_order_id bigint, ADD COLUMN beta_request_id uuid, ADD COLUMN sale_request_id bigint REFERENCES core.beta_sale_request,
  ADD CONSTRAINT installment_contract_beta_order UNIQUE (scheme_id, beta_order_id);
CREATE FUNCTION core.trg_contract_beta_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.beta_order_id IS NOT NULL AND NEW.beta_order_id IS DISTINCT FROM OLD.beta_order_id)
     OR (OLD.beta_request_id IS NOT NULL AND NEW.beta_request_id IS DISTINCT FROM OLD.beta_request_id)
     OR (OLD.sale_request_id IS NOT NULL AND NEW.sale_request_id IS DISTINCT FROM OLD.sale_request_id) THEN
    RAISE EXCEPTION 'the Beta link of contract % is set once and never changed', OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_beta_link BEFORE UPDATE ON core.installment_contract FOR EACH ROW EXECUTE FUNCTION core.trg_contract_beta_link();

CREATE TABLE core.beta_installment_link (
  installment_id bigint PRIMARY KEY REFERENCES core.installment, scheme_id int NOT NULL, beta_order_id bigint NOT NULL,
  beta_installment_id bigint NOT NULL, linked_by text NOT NULL, linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheme_id, beta_installment_id));
CREATE TRIGGER beta_installment_link_immutable BEFORE UPDATE OR DELETE ON core.beta_installment_link FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

-- who owns a contract (append-only; the latest row is current; changing the owner is an audited new row)
CREATE TABLE core.contract_agent (
  id bigserial PRIMARY KEY, contract_id bigint NOT NULL REFERENCES core.installment_contract, agent_id int REFERENCES core.sales_agent,  -- NULL = Almas
  source text NOT NULL CHECK (source IN ('sale_request', 'manual', 'import')), reason text NOT NULL,
  assigned_by text NOT NULL, assigned_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER contract_agent_immutable BEFORE UPDATE OR DELETE ON core.contract_agent FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();
CREATE VIEW core.contract_owner AS
SELECT DISTINCT ON (contract_id) contract_id, agent_id, assigned_at FROM core.contract_agent ORDER BY contract_id, assigned_at DESC, id DESC;

-- ============ Agent entitlements and settlements (formula OPEN: D-22) ============
CREATE TABLE core.agent_entitlement (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, contract_id bigint NOT NULL REFERENCES core.installment_contract,
  installment_id bigint REFERENCES core.installment, receipt_id bigint REFERENCES core.receipt,
  basis text NOT NULL CHECK (basis IN ('sale', 'collection', 'adjustment')),
  amount numeric(20,0) NOT NULL CHECK (amount <> 0),          -- negative only for 'adjustment' (e.g. clawback)
  rule_ref text NOT NULL CHECK (btrim(rule_ref) <> ''),         -- which agreement / decision this amount comes from
  note text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text, journal_entry_id bigint REFERENCES core.journal_entry,
  CHECK (amount > 0 OR basis = 'adjustment'), CHECK (basis <> 'collection' OR receipt_id IS NOT NULL));
CREATE TABLE core.agent_settlement (
  id bigserial PRIMARY KEY, agent_id int NOT NULL REFERENCES core.sales_agent, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  paid_at date NOT NULL, method text NOT NULL, company_bank_account_id int REFERENCES core.company_bank_account, cash_desk text, bank_ref text,
  note text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz, reversed_by text, reversal_reason text, journal_entry_id bigint REFERENCES core.journal_entry,
  CHECK (company_bank_account_id IS NOT NULL OR cash_desk IS NOT NULL));
CREATE TABLE core.agent_settlement_allocation (
  id bigserial PRIMARY KEY, settlement_id bigint NOT NULL REFERENCES core.agent_settlement,
  entitlement_id bigint NOT NULL REFERENCES core.agent_entitlement, amount numeric(20,0) NOT NULL CHECK (amount > 0),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER agent_settlement_allocation_immutable BEFORE UPDATE OR DELETE ON core.agent_settlement_allocation FOR EACH ROW EXECUTE FUNCTION core.trg_immutable();

CREATE FUNCTION core.trg_reversible_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '% rows are never deleted; reverse instead', TG_TABLE_NAME; END IF;
  IF (to_jsonb(NEW) - '{reversed_at,reversed_by,reversal_reason,journal_entry_id}'::text[])
     IS DISTINCT FROM (to_jsonb(OLD) - '{reversed_at,reversed_by,reversal_reason,journal_entry_id}'::text[])
     OR (OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at) THEN
    RAISE EXCEPTION '% % is immutable (only a one-time reversal is allowed)', TG_TABLE_NAME, OLD.id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_entitlement_rules BEFORE UPDATE OR DELETE ON core.agent_entitlement FOR EACH ROW EXECUTE FUNCTION core.trg_reversible_fact();
CREATE TRIGGER agent_settlement_rules BEFORE UPDATE OR DELETE ON core.agent_settlement FOR EACH ROW EXECUTE FUNCTION core.trg_reversible_fact();

CREATE VIEW core.agent_entitlement_status AS
SELECT e.*, coalesce((SELECT sum(a.amount) FROM core.agent_settlement_allocation a JOIN core.agent_settlement s ON s.id = a.settlement_id
                      WHERE a.entitlement_id = e.id AND s.reversed_at IS NULL), 0) AS settled,
       CASE WHEN e.reversed_at IS NOT NULL THEN 0
            ELSE e.amount - coalesce((SELECT sum(a.amount) FROM core.agent_settlement_allocation a JOIN core.agent_settlement s ON s.id = a.settlement_id
                                      WHERE a.entitlement_id = e.id AND s.reversed_at IS NULL), 0) END AS open_amount
FROM core.agent_entitlement e;

CREATE VIEW core.agent_settlement_status AS
SELECT s.*, coalesce((SELECT sum(amount) FROM core.agent_settlement_allocation WHERE settlement_id = s.id), 0) AS allocated,
       s.amount - coalesce((SELECT sum(amount) FROM core.agent_settlement_allocation WHERE settlement_id = s.id), 0) AS unallocated
FROM core.agent_settlement s;

CREATE VIEW core.agent_balance AS
SELECT g.id AS agent_id, g.code, g.title,
       coalesce((SELECT sum(amount) FROM core.agent_entitlement WHERE agent_id = g.id AND reversed_at IS NULL), 0) AS entitled,
       coalesce((SELECT sum(amount) FROM core.agent_settlement WHERE agent_id = g.id AND reversed_at IS NULL), 0) AS paid,
       coalesce((SELECT sum(amount) FROM core.agent_entitlement WHERE agent_id = g.id AND reversed_at IS NULL), 0)
       - coalesce((SELECT sum(amount) FROM core.agent_settlement WHERE agent_id = g.id AND reversed_at IS NULL), 0) AS balance_due
FROM core.sales_agent g;

-- ============ Access: central staff vs agent workspace ============
-- a person or agent may act on a sale request: its own agent (agent.workspace), or central staff (beta.sale_manage)
CREATE FUNCTION core.require_sale_access(p_user text, p_request bigint) RETURNS core.beta_sale_request LANGUAGE plpgsql AS $$
DECLARE r core.beta_sale_request; my int := core.agent_of(p_user);
BEGIN
  SELECT * INTO r FROM core.beta_sale_request WHERE id = p_request;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale request % not found', p_request; END IF;
  IF my IS NOT NULL THEN
    PERFORM core.require_permission(p_user, 'agent.workspace');
    IF r.agent_id IS DISTINCT FROM my THEN
      RAISE EXCEPTION 'permission denied: sale request % belongs to another agent', p_request USING ERRCODE = 'insufficient_privilege'; END IF;
  ELSE
    PERFORM core.require_permission(p_user, 'beta.sale_manage');
  END IF;
  RETURN r;
END $$;

-- ============ Sale workflow (what the agent / staff sees: simple steps; bank details stay behind) ============
CREATE FUNCTION core.beta_sale_create(p_user text, p_national_id text, p_customer_name text, p_title text, p_amount numeric,
  p_installments int, p_start_year_month text, p_internal_ref text DEFAULT NULL, p_agent int DEFAULT NULL, p_scheme int DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE my int := core.agent_of(p_user); sch int := p_scheme; ag int := p_agent; rid bigint; nid text := lpad(btrim(translate(p_national_id, '۰۱۲۳۴۵۶۷۸۹', '0123456789')), 10, '0');
BEGIN
  IF my IS NOT NULL THEN
    PERFORM core.require_permission(p_user, 'agent.workspace');
    IF ag IS NOT NULL AND ag <> my THEN RAISE EXCEPTION 'permission denied: an agent sells only for itself' USING ERRCODE = 'insufficient_privilege'; END IF;
    ag := my;
    IF (SELECT status FROM core.sales_agent WHERE id = my) <> 'active' THEN RAISE EXCEPTION 'agent % is not active', my; END IF;
  ELSE
    PERFORM core.require_permission(p_user, 'beta.sale_manage');
  END IF;
  IF sch IS NULL THEN
    IF (SELECT count(*) FROM core.beta_scheme WHERE status = 'active') <> 1 THEN RAISE EXCEPTION 'choose the Beta scheme (more than one is active)'; END IF;
    SELECT id INTO sch FROM core.beta_scheme WHERE status = 'active';
  ELSIF (SELECT status FROM core.beta_scheme WHERE id = sch) IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'Beta scheme % is not active', sch; END IF;
  IF NOT core.valid_national_id(nid) THEN RAISE EXCEPTION 'کد ملی معتبر نیست'; END IF;
  IF p_installments NOT BETWEEN 1 AND 36 THEN RAISE EXCEPTION 'تعداد اقساط باید بین ۱ و ۳۶ باشد (خطای ۴۴۶۲ بتا)'; END IF;
  INSERT INTO core.beta_sale_request (scheme_id, agent_id, national_id, party_id, customer_name, title, amount, installment_count, start_year_month,
                                      internal_ref, created_by)
  VALUES (sch, ag, nid, (SELECT id FROM core.party WHERE national_id = nid AND merged_into_id IS NULL), p_customer_name, p_title, p_amount,
          p_installments, p_start_year_month, p_internal_ref, p_user) RETURNING id INTO rid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'beta_sale_request', rid::text,
    jsonb_build_object('agent_id', ag, 'scheme_id', sch, 'amount', p_amount, 'installments', p_installments));
  RETURN rid;
END $$;

-- change the data of a sale request before the bank registered it: any change invalidates an OTP already sent
CREATE FUNCTION core.beta_sale_change(p_user text, p_request bigint, p_title text, p_amount numeric, p_installments int, p_start_year_month text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r core.beta_sale_request := core.require_sale_access(p_user, p_request);
BEGIN
  IF r.status NOT IN ('draft', 'checked', 'otp_sent', 'failed') THEN RAISE EXCEPTION 'sale request % is %; it cannot change', p_request, r.status; END IF;
  UPDATE core.beta_sale_request SET title = coalesce(p_title, title), amount = coalesce(p_amount, amount),
         installment_count = coalesce(p_installments, installment_count), start_year_month = coalesce(p_start_year_month, start_year_month),
         status = CASE WHEN checked_credit IS NULL THEN 'draft' ELSE 'checked' END, otp_sent_at = NULL, otp_expires_at = NULL,
         otp_fingerprint = NULL, failure = NULL
  WHERE id = p_request;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, before, after) VALUES (p_user, 'change', 'beta_sale_request', p_request::text,
    jsonb_build_object('title', r.title, 'amount', r.amount, 'installments', r.installment_count, 'start', r.start_year_month),
    jsonb_build_object('title', p_title, 'amount', p_amount, 'installments', p_installments, 'start', p_start_year_month));
END $$;

CREATE FUNCTION core.beta_sale_abandon(p_user text, p_request bigint, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r core.beta_sale_request := core.require_sale_access(p_user, p_request);
BEGIN
  PERFORM core.require_reason(p_reason);
  IF r.status IN ('unknown_outcome', 'consumed', 'contracted') THEN
    RAISE EXCEPTION 'sale request % is % at the bank; it cannot be abandoned here', p_request, r.status; END IF;
  UPDATE core.beta_sale_request SET status = 'abandoned', failure = p_reason WHERE id = p_request;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'abandon', 'beta_sale_request', p_request::text, p_reason);
END $$;

-- local checks before an OTP is requested (the bank remains the final judge). Blocks only what the document makes certain.
CREATE FUNCTION core.beta_sale_precheck(p_user text, p_request bigint, p_now timestamptz DEFAULT now())
RETURNS TABLE (ok boolean, blocking text[], warnings text[], installment_amount numeric, credit numeric, valid_months text[]) LANGUAGE plpgsql AS $$
DECLARE r core.beta_sale_request := core.require_sale_access(p_user, p_request); b text[] := '{}'; w text[] := '{}';
        cr numeric; cr_at timestamptz; vm text[]; vm_at timestamptz; inst numeric; n_month int;
BEGIN
  inst := ceil(r.amount / r.installment_count);
  SELECT o.credit, o.observed_at INTO cr, cr_at FROM core.beta_credit_observation o JOIN core.beta_api_call c ON c.id = o.call_id
  WHERE o.national_id = r.national_id AND c.scheme_id = r.scheme_id ORDER BY o.observed_at DESC, o.id DESC LIMIT 1;
  SELECT o.months, o.observed_at INTO vm, vm_at FROM core.beta_valid_month_observation o WHERE o.scheme_id = r.scheme_id ORDER BY o.observed_at DESC LIMIT 1;
  IF r.status NOT IN ('draft', 'checked', 'otp_sent', 'failed') THEN b := b || format('وضعیت درخواست «%s» است', r.status); END IF;
  IF r.status = 'otp_sent' AND r.otp_expires_at > p_now THEN b := array_append(b, 'رمز یکبار مصرف قبلی هنوز معتبر است (۲ دقیقه؛ خطای ۴۴۴۴)'::text); END IF;
  IF cr IS NULL OR cr_at < p_now - interval '1 day' THEN b := array_append(b, 'استعلام توان بازپرداخت امروز انجام نشده است'::text);
  ELSIF cr <= 0 THEN b := array_append(b, 'توان بازپرداخت مشتری صفر است (اهلیت اعتباری ندارد)'::text);
  ELSIF inst > cr THEN b := b || format('مبلغ هر قسط (%s) از توان بازپرداخت ماهانه (%s) بیشتر است', inst, cr);
  ELSIF r.amount > cr THEN w := array_append(w, 'اگر «اعتبار» بتا سقف کل باشد نه ماهانه، این مبلغ رد می‌شود (U-B1)'::text); END IF;
  IF vm IS NULL OR vm_at < p_now - interval '1 day' THEN w := array_append(w, 'فهرست ماه‌های مجاز شروع اقساط امروز دریافت نشده است'::text);
  ELSIF NOT (r.start_year_month = ANY (vm)) THEN b := b || format('ماه شروع %s در فهرست ماه‌های مجاز بتا نیست', r.start_year_month); END IF;
  SELECT count(*) INTO n_month FROM core.beta_sale_request x
  WHERE x.scheme_id = r.scheme_id AND x.national_id = r.national_id AND x.id <> r.id AND x.status IN ('consumed', 'contracted', 'unknown_outcome')
    AND core.jalali_ym(x.created_at::date) = core.jalali_ym(p_now::date);
  IF n_month >= 8 THEN b := array_append(b, 'این مشتری در این ماه ۸ خرید از این پذیرنده دارد (خطای ۴۴۶۳)'::text); END IF;
  RETURN QUERY SELECT cardinality(b) = 0, b, w, inst, cr, vm;
END $$;

-- ============ Recording a call and deriving its effect (one transaction) ============
CREATE FUNCTION core.beta_authorize_call(p_user text, p_endpoint text, p_request bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF core.setting_value('beta_api_mode') = 'disabled' THEN RAISE EXCEPTION 'Beta API is disabled (setting beta_api_mode; D-23)'; END IF;
  IF p_endpoint IN ('order_delete', 'installment_delete', 'edit_request', 'edit') THEN
    PERFORM core.require_permission(p_user, 'beta.order_change'); RETURN; END IF;
  IF core.agent_of(p_user) IS NOT NULL THEN
    IF p_endpoint = 'valid_months' THEN PERFORM core.require_permission(p_user, 'agent.workspace'); RETURN; END IF;
    IF p_endpoint NOT IN ('credit_inquiry', 'otp_request', 'consume', 'order_by_request_id') OR p_request IS NULL THEN
      RAISE EXCEPTION 'permission denied: an agent calls only the sale steps of its own requests' USING ERRCODE = 'insufficient_privilege'; END IF;
    PERFORM core.require_sale_access(p_user, p_request); RETURN;
  END IF;
  IF p_request IS NOT NULL THEN PERFORM core.require_sale_access(p_user, p_request); ELSE PERFORM core.require_permission(p_user, 'beta.api_call'); END IF;
END $$;

CREATE FUNCTION core.beta_record_call(p_user text, p_scheme int, p_endpoint text, p_method text, p_path text, p_request_body jsonb,
  p_http_status int, p_response jsonb, p_transport_error text, p_started_at timestamptz, p_sale_request bigint DEFAULT NULL, p_order_ref bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cid bigint; bs int; outc text; msg text; env text := core.setting_value('beta_api_mode'); body jsonb := p_request_body;
BEGIN
  PERFORM core.beta_authorize_call(p_user, p_endpoint, p_sale_request);
  IF body ? 'otp' THEN body := jsonb_set(body, '{otp}', '"***"'); END IF;                 -- the OTP is never stored
  bs := CASE WHEN core.jf(p_response, 'status') ~ '^-?[0-9]+$' THEN core.jf(p_response, 'status')::int END;
  msg := core.jf(p_response, 'message');
  outc := CASE WHEN p_http_status IS NULL THEN 'no_response' WHEN p_http_status <> 200 THEN 'http_error'
               WHEN coalesce(bs, 200) = 200 THEN 'ok' ELSE 'business_error' END;
  INSERT INTO core.beta_api_call (scheme_id, environment, api_revision, endpoint, http_method, path, request_body, sale_request_id, order_ref,
                                  http_status, business_status, message, response, transport_error, outcome, started_at, called_by, response_sha256)
  VALUES (p_scheme, env, core.setting_value('beta_api_revision'), p_endpoint, p_method, p_path, body, p_sale_request, p_order_ref,
          p_http_status, bs, msg, p_response, p_transport_error, outc, p_started_at, p_user,
          CASE WHEN p_response IS NOT NULL THEN encode(digest(p_response::text, 'sha256'), 'hex') END)
  RETURNING id INTO cid;
  BEGIN                                            -- the evidence is kept even when its response cannot be read (BA-13)
    PERFORM core.beta_ingest_call(cid);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO core.beta_ingest_error (call_id, error) VALUES (cid, SQLERRM);
  END;
  RETURN cid;
END $$;

-- turn one recorded call into observations and sale-request state (idempotent per call: observations reference the call)
CREATE FUNCTION core.beta_ingest_call(p_call bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c core.beta_api_call; d jsonb; x jsonb; oid bigint; req core.beta_sale_request; ym text; s text;
BEGIN
  SELECT * INTO c FROM core.beta_api_call WHERE id = p_call;
  IF EXISTS (SELECT 1 FROM core.beta_order_observation WHERE call_id = p_call) OR EXISTS (SELECT 1 FROM core.beta_installment_observation WHERE call_id = p_call)
     OR EXISTS (SELECT 1 FROM core.beta_credit_observation WHERE call_id = p_call) OR EXISTS (SELECT 1 FROM core.beta_valid_month_observation WHERE call_id = p_call) THEN
    RETURN; END IF;
  d := c.response -> 'data';
  IF d IS NULL THEN d := c.response -> 'Data'; END IF;
  IF c.sale_request_id IS NOT NULL THEN SELECT * INTO req FROM core.beta_sale_request WHERE id = c.sale_request_id; END IF;

  IF c.endpoint = 'credit_inquiry' AND c.outcome = 'ok' AND d IS NOT NULL AND core.jf(d, 'credit') IS NOT NULL THEN
    INSERT INTO core.beta_credit_observation (call_id, national_id, credit, observed_at)
    VALUES (p_call, lpad(coalesce(core.jf(d, 'nationalCode'), req.national_id), 10, '0'), core.jf(d, 'credit')::numeric, c.finished_at);
    IF req.id IS NOT NULL AND req.status IN ('draft', 'checked', 'failed') THEN
      UPDATE core.beta_sale_request SET status = 'checked', checked_credit = core.jf(d, 'credit')::numeric, checked_at = c.finished_at,
             last_call_id = p_call, last_status = 200, failure = NULL WHERE id = req.id; END IF;

  ELSIF c.endpoint = 'valid_months' AND c.outcome = 'ok' THEN
    x := CASE WHEN jsonb_typeof(coalesce(d -> 'data', d -> 'Data')) = 'object' THEN coalesce(d -> 'data', d -> 'Data') ELSE d END;
    IF jsonb_typeof(x) = 'object' THEN
      INSERT INTO core.beta_valid_month_observation (call_id, scheme_id, months, observed_at)
      SELECT p_call, c.scheme_id, coalesce(array_agg(k ORDER BY k) FILTER (WHERE k ~ '^1[3-5][0-9]{2}/(0[1-9]|1[0-2])$'), '{}'), c.finished_at
      FROM jsonb_object_keys(x) k; END IF;

  ELSIF c.endpoint = 'otp_request' AND req.id IS NOT NULL THEN
    IF c.outcome = 'ok' THEN
      UPDATE core.beta_sale_request SET status = 'otp_sent', otp_sent_at = c.finished_at, otp_expires_at = c.finished_at + interval '2 minutes',
             otp_fingerprint = core.beta_sale_fingerprint(req), last_call_id = p_call, last_status = 200, failure = NULL WHERE id = req.id;
    ELSE
      UPDATE core.beta_sale_request SET last_call_id = p_call, last_status = coalesce(c.business_status, c.http_status),
             failure = coalesce(c.message, c.transport_error, (core.beta_status_meaning('otp_request', c.business_status)).meaning_fa) WHERE id = req.id;
    END IF;

  ELSIF c.endpoint = 'consume' AND req.id IS NOT NULL THEN
    IF c.outcome = 'ok' AND core.jf(c.response, 'data') ~ '^[0-9]+$' THEN
      oid := core.jf(c.response, 'data')::bigint;
      INSERT INTO core.beta_order (scheme_id, beta_order_id, request_id, national_id, first_call_id)
      VALUES (c.scheme_id, oid, req.request_id, req.national_id, p_call) ON CONFLICT DO NOTHING;
      UPDATE core.beta_sale_request SET status = 'consumed', beta_order_id = oid, last_call_id = p_call, last_status = 200, failure = NULL WHERE id = req.id;
    ELSIF c.outcome IN ('no_response', 'http_error') OR c.business_status = 4406 OR c.outcome = 'ok' THEN
      -- the bank may have registered the sale: never retry blindly; resolve with order/{requestId} (BA-09)
      UPDATE core.beta_sale_request SET status = 'unknown_outcome', last_call_id = p_call, last_status = coalesce(c.business_status, c.http_status),
             failure = 'نتیجه ثبت فروش نامعلوم است؛ با شناسه یکتا استعلام شود' WHERE id = req.id;
    ELSIF c.business_status = 4446 THEN
      UPDATE core.beta_sale_request SET last_call_id = p_call, last_status = 4446, failure = 'رمز یکبار مصرف اشتباه است' WHERE id = req.id;
    ELSE
      UPDATE core.beta_sale_request SET status = 'failed', last_call_id = p_call, last_status = c.business_status, otp_expires_at = NULL,
             failure = coalesce((core.beta_status_meaning('consume', c.business_status)).meaning_fa, c.message) WHERE id = req.id;
    END IF;

  ELSIF c.endpoint = 'order_by_request_id' AND c.outcome = 'ok' THEN
    IF jsonb_typeof(d) = 'object' AND core.jf(d, 'id') ~ '^[0-9]+$' THEN
      oid := core.jf(d, 'id')::bigint;
      INSERT INTO core.beta_order (scheme_id, beta_order_id, request_id, national_id, first_call_id)
      VALUES (c.scheme_id, oid, req.request_id, lpad(core.jf(d, 'customerNationalCode'), 10, '0'), p_call) ON CONFLICT DO NOTHING;
      INSERT INTO core.beta_order_observation (call_id, scheme_id, beta_order_id, present, title, amount, national_id, description, project_type, observed_at)
      VALUES (p_call, c.scheme_id, oid, true, core.jf(d, 'title'), core.jf(d, 'amount')::numeric, lpad(core.jf(d, 'customerNationalCode'), 10, '0'),
              core.jf(d, 'description'), core.jf(d, 'projectType')::int, c.finished_at);
      IF req.id IS NOT NULL AND req.status IN ('unknown_outcome', 'otp_sent', 'checked', 'failed') THEN
        UPDATE core.beta_sale_request SET status = 'consumed', beta_order_id = oid, last_call_id = p_call, last_status = 200, failure = NULL WHERE id = req.id; END IF;
    ELSIF req.id IS NOT NULL AND req.status = 'unknown_outcome' AND (d IS NULL OR jsonb_typeof(d) = 'null') THEN
      -- the bank answered and has no sale for this requestId: the OTP was not consumed; start again from a new OTP
      UPDATE core.beta_sale_request SET status = 'checked', otp_expires_at = NULL, last_call_id = p_call, last_status = 200,
             failure = 'فروشی با این شناسه یکتا در بتا ثبت نشده است؛ رمز جدید لازم است' WHERE id = req.id;
    END IF;

  ELSIF c.endpoint = 'order_list' AND c.outcome = 'ok' THEN
    ym := substring(c.path FROM 'order/([0-9]{6})/all');
    FOR x IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(coalesce(d -> 'data', d -> 'Data')) = 'array' THEN coalesce(d -> 'data', d -> 'Data') WHEN jsonb_typeof(d) = 'array' THEN d ELSE '[]' END) LOOP
      oid := core.jf(x, 'id')::bigint;
      INSERT INTO core.beta_order (scheme_id, beta_order_id, national_id, first_call_id)
      VALUES (c.scheme_id, oid, lpad(core.jf(x, 'customerNationalCode'), 10, '0'), p_call) ON CONFLICT DO NOTHING;
      INSERT INTO core.beta_order_observation (call_id, scheme_id, beta_order_id, present, title, amount, national_id, description, project_type,
                                               list_year_month, observed_at)
      VALUES (p_call, c.scheme_id, oid, true, core.jf(x, 'title'), core.jf(x, 'amount')::numeric, lpad(core.jf(x, 'customerNationalCode'), 10, '0'),
              core.jf(x, 'description'), core.jf(x, 'projectType')::int, ym, c.finished_at);
    END LOOP;
    -- no paging is documented: a list shorter than its totalRecords is incomplete evidence (U-B12, BA-13)
    IF core.jf(d, 'totalRecords') ~ '^[0-9]+$' AND core.jf(d, 'totalRecords')::int
       <> jsonb_array_length(CASE WHEN jsonb_typeof(coalesce(d -> 'data', d -> 'Data')) = 'array' THEN coalesce(d -> 'data', d -> 'Data') ELSE '[]' END) THEN
      INSERT INTO core.beta_ingest_error (call_id, error) VALUES (p_call, format('order list incomplete: totalRecords %s', core.jf(d, 'totalRecords')));
    END IF;

  ELSIF c.endpoint = 'order_installments' AND c.order_ref IS NOT NULL THEN
    IF c.outcome = 'ok' THEN
      FOR x IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(coalesce(d -> 'data', d -> 'Data')) = 'array' THEN coalesce(d -> 'data', d -> 'Data') WHEN jsonb_typeof(d) = 'array' THEN d ELSE '[]' END) LOOP
        s := core.jf(x, 'status');
        INSERT INTO core.beta_installment_observation (call_id, scheme_id, beta_order_id, beta_installment_id, amount, overdue_raw, overdue_date,
                                                       settle_raw, settle_date, is_settled, status_raw, status_title, is_deleted, observed_at)
        VALUES (p_call, c.scheme_id, coalesce(core.jf(x, 'orderId')::bigint, c.order_ref), core.jf(x, 'id')::bigint, core.jf(x, 'amount')::numeric,
                core.jf(x, 'overdueDate'), core.beta_date(core.jf(x, 'overdueDate')), coalesce(core.jf(x, 'settelDate'), core.jf(x, 'settleDate')),
                core.beta_date(coalesce(core.jf(x, 'settelDate'), core.jf(x, 'settleDate'))),
                coalesce(core.jf(x, 'isSetteled'), core.jf(x, 'isSettled'))::boolean, s, core.jf(x, 'statusTitle'),
                coalesce(core.jf(x, 'isDeleted'), 'false')::boolean, c.finished_at);
      END LOOP;
      INSERT INTO core.beta_order (scheme_id, beta_order_id, first_call_id) VALUES (c.scheme_id, c.order_ref, p_call) ON CONFLICT DO NOTHING;
    ELSIF c.business_status = 4460 THEN
      INSERT INTO core.beta_order_observation (call_id, scheme_id, beta_order_id, present, observed_at)
      SELECT p_call, c.scheme_id, c.order_ref, false, c.finished_at WHERE EXISTS (SELECT 1 FROM core.beta_order WHERE scheme_id = c.scheme_id AND beta_order_id = c.order_ref);
    END IF;
  END IF;
END $$;

-- ============ From an official order to an Almas contract (central; the agent never does this) ============
-- The schedule is taken from the bank's own installment table (latest call): amounts and due dates are evidence, not computed.
CREATE FUNCTION core.beta_contract_from_order(p_scheme int, p_order bigint, p_user text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE cid bigint; o core.beta_order_latest; req core.beta_sale_request; pid int; n int; tot numeric; first_due date;
BEGIN
  PERFORM core.require_permission(p_user, 'beta.contract_manage');
  SELECT id INTO cid FROM core.installment_contract WHERE scheme_id = p_scheme AND beta_order_id = p_order;
  IF FOUND THEN RETURN cid; END IF;                                                    -- idempotent
  SELECT * INTO o FROM core.beta_order_latest WHERE scheme_id = p_scheme AND beta_order_id = p_order;
  IF NOT FOUND OR o.installments_call_id IS NULL THEN RAISE EXCEPTION 'order %: fetch its installment table from Beta first', p_order; END IF;
  IF NOT o.present THEN RAISE EXCEPTION 'order % is not valid at Beta (4460)', p_order; END IF;
  SELECT count(*), sum(amount), min(overdue_date) INTO n, tot, first_due FROM core.beta_installment_observation
  WHERE call_id = o.installments_call_id AND NOT coalesce(is_deleted, false);
  IF n = 0 THEN RAISE EXCEPTION 'order % has no live installment at Beta', p_order; END IF;
  IF EXISTS (SELECT 1 FROM core.beta_installment_observation WHERE call_id = o.installments_call_id AND NOT coalesce(is_deleted, false)
             AND (overdue_date IS NULL OR amount IS NULL OR amount <= 0)) THEN
    RAISE EXCEPTION 'order %: an installment has no readable due date or amount (see overdue_raw)', p_order; END IF;
  SELECT * INTO req FROM core.beta_sale_request WHERE scheme_id = p_scheme AND beta_order_id = p_order;
  pid := coalesce(req.party_id, (SELECT id FROM core.party WHERE national_id = coalesce(req.national_id, o.national_id) AND merged_into_id IS NULL));
  IF pid IS NULL THEN
    IF NOT core.valid_national_id(coalesce(req.national_id, o.national_id)) THEN RAISE EXCEPTION 'order %: customer national id is not valid', p_order; END IF;
    INSERT INTO core.party (name, national_id) VALUES (coalesce(req.customer_name, 'مشتری بتا ' || coalesce(req.national_id, o.national_id)),
                                                       coalesce(req.national_id, o.national_id)) RETURNING id INTO pid;
  END IF;
  INSERT INTO core.installment_contract (scheme_id, party_id, bank_contract_id, registered_at, sale_ref, total_amount, installment_count, first_due_date,
                                         source, created_by, beta_order_id, beta_request_id, sale_request_id)
  VALUES (p_scheme, pid, p_order::text, coalesce(req.updated_at, now())::timestamp, req.internal_ref, tot, n, first_due, 'beta_import', p_user,
          p_order, coalesce(req.request_id, o.request_id), req.id) RETURNING id INTO cid;
  INSERT INTO core.installment (contract_id, seq, due_date, amount)
  SELECT cid, row_number() OVER (ORDER BY overdue_date, beta_installment_id), overdue_date, amount
  FROM core.beta_installment_observation WHERE call_id = o.installments_call_id AND NOT coalesce(is_deleted, false);
  INSERT INTO core.beta_installment_link (installment_id, scheme_id, beta_order_id, beta_installment_id, linked_by)
  SELECT i.id, p_scheme, p_order, b.beta_installment_id, p_user
  FROM (SELECT beta_installment_id, row_number() OVER (ORDER BY overdue_date, beta_installment_id) seq FROM core.beta_installment_observation
        WHERE call_id = o.installments_call_id AND NOT coalesce(is_deleted, false)) b
  JOIN core.installment i ON i.contract_id = cid AND i.seq = b.seq;
  UPDATE core.installment_contract SET status = 'active', activated_by = p_user WHERE id = cid;
  INSERT INTO core.contract_agent (contract_id, agent_id, source, reason, assigned_by)
  VALUES (cid, req.agent_id, CASE WHEN req.id IS NULL THEN 'import' ELSE 'sale_request' END,
          CASE WHEN req.id IS NULL THEN 'order found at Beta without an Almas sale request' ELSE 'sale request ' || req.id END, p_user);
  IF req.id IS NOT NULL THEN UPDATE core.beta_sale_request SET status = 'contracted', contract_id = cid, party_id = pid WHERE id = req.id; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create_from_beta', 'installment_contract', cid::text,
    jsonb_build_object('beta_order_id', p_order, 'installments_call_id', o.installments_call_id, 'total', tot, 'count', n, 'agent_id', req.agent_id));
  RETURN cid;
END $$;

-- ============ Agent administration and money (central) ============
CREATE FUNCTION core.agent_create(p_code text, p_title text, p_party int, p_province text, p_city text, p_user text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE aid int;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.manage');
  INSERT INTO core.sales_agent (code, title, party_id, province, city, created_by) VALUES (p_code, p_title, p_party, p_province, p_city, p_user) RETURNING id INTO aid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'agent', aid::text, jsonb_build_object('code', p_code));
  RETURN aid;
END $$;

CREATE FUNCTION core.agent_bind_user(p_username text, p_agent int, p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.manage');
  INSERT INTO core.sales_agent_user (username, agent_id, bound_by) VALUES (p_username, p_agent, p_user);
  INSERT INTO core.user_permission (username, permission, granted_by, reason) VALUES (p_username, 'agent.workspace', p_user, 'agent user')
  ON CONFLICT DO NOTHING;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'bind', 'agent_user', p_username, jsonb_build_object('agent_id', p_agent));
END $$;

CREATE FUNCTION core.agent_assign_contract(p_contract bigint, p_agent int, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.manage'); PERFORM core.require_reason(p_reason);
  IF EXISTS (SELECT 1 FROM core.agent_entitlement WHERE contract_id = p_contract AND reversed_at IS NULL AND agent_id IS DISTINCT FROM p_agent) THEN
    RAISE EXCEPTION 'contract % has live entitlements of another agent; reverse them first', p_contract; END IF;
  INSERT INTO core.contract_agent (contract_id, agent_id, source, reason, assigned_by) VALUES (p_contract, p_agent, 'manual', p_reason, p_user);
END $$;

CREATE FUNCTION core.agent_record_entitlement(p_agent int, p_contract bigint, p_basis text, p_amount numeric, p_rule_ref text, p_user text,
  p_installment bigint DEFAULT NULL, p_receipt bigint DEFAULT NULL, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE eid bigint;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.entitlement');
  IF (SELECT agent_id FROM core.contract_owner WHERE contract_id = p_contract) IS DISTINCT FROM p_agent THEN
    RAISE EXCEPTION 'contract % is not owned by agent %', p_contract, p_agent; END IF;
  IF p_installment IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.installment WHERE id = p_installment AND contract_id = p_contract) THEN
    RAISE EXCEPTION 'installment % is not of contract %', p_installment, p_contract; END IF;
  IF p_receipt IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM core.receipt r JOIN core.receipt_allocation a ON a.receipt_id = r.id JOIN core.installment i ON i.id = a.installment_id
       WHERE r.id = p_receipt AND r.reversed_at IS NULL AND i.contract_id = p_contract AND (p_installment IS NULL OR i.id = p_installment)) THEN
    RAISE EXCEPTION 'receipt % is not a live collection of contract %', p_receipt, p_contract; END IF;
  INSERT INTO core.agent_entitlement (agent_id, contract_id, installment_id, receipt_id, basis, amount, rule_ref, note, created_by)
  VALUES (p_agent, p_contract, p_installment, p_receipt, p_basis, p_amount, p_rule_ref, p_note, p_user) RETURNING id INTO eid;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'agent_entitlement', eid::text,
    jsonb_build_object('agent_id', p_agent, 'contract_id', p_contract, 'amount', p_amount, 'rule_ref', p_rule_ref));
  RETURN eid;
END $$;

CREATE FUNCTION core.agent_reverse_entitlement(p_entitlement bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.entitlement'); PERFORM core.require_reason(p_reason);
  IF (SELECT settled FROM core.agent_entitlement_status WHERE id = p_entitlement) > 0 THEN
    RAISE EXCEPTION 'entitlement % is (partly) settled; reverse the settlement first or record a negative adjustment', p_entitlement; END IF;
  UPDATE core.agent_entitlement SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason WHERE id = p_entitlement AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'entitlement % not found or already reversed', p_entitlement; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'agent_entitlement', p_entitlement::text, p_reason);
END $$;

-- one payment to an agent and exactly which entitlements it covers (atomic; never more than what is open)
CREATE FUNCTION core.agent_record_settlement(p_agent int, p_amount numeric, p_paid_at date, p_method text, p_bank_account int, p_cash_desk text,
  p_bank_ref text, p_allocations jsonb, p_user text, p_note text DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE sid bigint; a jsonb; e core.agent_entitlement_status; total numeric := 0;
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle');
  INSERT INTO core.agent_settlement (agent_id, amount, paid_at, method, company_bank_account_id, cash_desk, bank_ref, note, created_by)
  VALUES (p_agent, p_amount, p_paid_at, p_method, p_bank_account, p_cash_desk, p_bank_ref, p_note, p_user) RETURNING id INTO sid;
  FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_allocations, '[]')) LOOP
    PERFORM 1 FROM core.agent_entitlement WHERE id = (a ->> 'entitlement_id')::bigint FOR UPDATE;
    SELECT * INTO e FROM core.agent_entitlement_status WHERE id = (a ->> 'entitlement_id')::bigint;
    IF NOT FOUND OR e.agent_id <> p_agent THEN RAISE EXCEPTION 'entitlement % is not of agent %', a ->> 'entitlement_id', p_agent; END IF;
    IF e.reversed_at IS NOT NULL OR (a ->> 'amount')::numeric > e.open_amount THEN
      RAISE EXCEPTION 'entitlement % has only % open', e.id, e.open_amount; END IF;
    INSERT INTO core.agent_settlement_allocation (settlement_id, entitlement_id, amount, created_by) VALUES (sid, e.id, (a ->> 'amount')::numeric, p_user);
    total := total + (a ->> 'amount')::numeric;
  END LOOP;
  IF total > p_amount THEN RAISE EXCEPTION 'allocations (%) exceed the payment (%)', total, p_amount; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, after) VALUES (p_user, 'create', 'agent_settlement', sid::text,
    jsonb_build_object('agent_id', p_agent, 'amount', p_amount, 'allocated', total));
  RETURN sid;
END $$;

CREATE FUNCTION core.agent_reverse_settlement(p_settlement bigint, p_user text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM core.require_permission(p_user, 'agent.settle'); PERFORM core.require_reason(p_reason);
  UPDATE core.agent_settlement SET reversed_at = now(), reversed_by = p_user, reversal_reason = p_reason WHERE id = p_settlement AND reversed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement % not found or already reversed', p_settlement; END IF;
  INSERT INTO core.audit_event (actor, action, object_type, object_id, reason) VALUES (p_user, 'reverse', 'agent_settlement', p_settlement::text, p_reason);
END $$;

-- ============ Lineage: one row per Beta contract across both layers ============
CREATE VIEW core.beta_sale_lineage AS
SELECT c.id AS contract_id, c.scheme_id, c.party_id, p.national_id AS customer_national_id, ow.agent_id, g.code AS agent_code,
       c.sale_request_id, coalesce(c.sale_ref, r.internal_ref) AS internal_ref, c.beta_order_id, c.beta_request_id, c.bank_contract_id,
       c.total_amount, c.installment_count, c.first_due_date, c.registered_at, c.status AS contract_status,
       bo.amount AS beta_amount, bo.present AS beta_present, bo.live_installments AS beta_live_installments,
       bo.settled_count AS beta_settled_count, bo.settled_amount AS beta_settled_amount, bo.last_settle_date AS beta_last_settle_date,
       cs.paid_count, cs.overdue_count, cs.outstanding_amount,
       (SELECT coalesce(sum(s.paid_by_bank), 0) FROM core.installment_status s WHERE s.contract_id = c.id) AS almas_bank_collected,
       (SELECT coalesce(sum(s.paid_direct), 0) FROM core.installment_status s WHERE s.contract_id = c.id) AS almas_direct_collected,
       (SELECT max(rc.value_date) FROM core.receipt rc JOIN core.receipt_allocation a ON a.receipt_id = rc.id JOIN core.installment i ON i.id = a.installment_id
         WHERE i.contract_id = c.id AND rc.reversed_at IS NULL AND rc.kind = 'bank_collection') AS almas_last_bank_collection,
       (SELECT coalesce(sum(amount), 0) FROM core.agent_entitlement WHERE contract_id = c.id AND reversed_at IS NULL) AS agent_entitled,
       (SELECT coalesce(sum(settled), 0) FROM core.agent_entitlement_status WHERE contract_id = c.id AND reversed_at IS NULL) AS agent_settled,
       (SELECT coalesce(sum(open_amount), 0) FROM core.agent_entitlement_status WHERE contract_id = c.id) AS agent_open
FROM core.installment_contract c JOIN core.party p ON p.id = c.party_id
LEFT JOIN core.contract_owner ow ON ow.contract_id = c.id LEFT JOIN core.sales_agent g ON g.id = ow.agent_id
LEFT JOIN core.beta_sale_request r ON r.id = c.sale_request_id
LEFT JOIN core.beta_order_latest bo ON bo.scheme_id = c.scheme_id AND bo.beta_order_id = c.beta_order_id
LEFT JOIN core.contract_status cs ON cs.contract_id = c.id
WHERE c.status <> 'draft';

-- per installment: what Almas knows vs what the bank said (linked installments only)
CREATE FUNCTION core.beta_installment_compare(p_as_of date) RETURNS TABLE (
  installment_id bigint, contract_id bigint, agent_id int, due_date date, amount numeric, almas_status text, paid_by_bank numeric, outstanding numeric,
  beta_installment_id bigint, beta_amount numeric, beta_due date, beta_settled boolean, beta_settle_date date, beta_status text, beta_status_verified boolean,
  beta_deleted boolean) LANGUAGE sql STABLE AS $$
  SELECT s.installment_id, s.contract_id, ow.agent_id, s.due_date, s.amount, s.status, s.paid_by_bank, s.outstanding,
         l.beta_installment_id, b.amount, b.overdue_date, b.is_settled, b.settle_date, b.status_name, b.status_verified, b.is_deleted
  FROM core.installment_status_at(p_as_of) s JOIN core.beta_installment_link l ON l.installment_id = s.installment_id
  LEFT JOIN core.beta_installment_latest b ON b.scheme_id = l.scheme_id AND b.beta_installment_id = l.beta_installment_id
  LEFT JOIN core.contract_owner ow ON ow.contract_id = s.contract_id $$;

-- ============ Controls (bank vs Almas, collection, accounting, agent settlement) ============
CREATE FUNCTION core.beta_network_controls(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  WITH cmp AS (SELECT * FROM core.beta_installment_compare(p_as_of)),
  api_schemes AS (SELECT scheme_id, min(finished_at) AS since FROM core.beta_api_call WHERE outcome = 'ok' GROUP BY scheme_id)
  SELECT 'beta', 'BA-01', 'high', 'فروش ثبت‌شده در بتا که در الماس قرارداد ندارد', count(*), coalesce(sum(o.amount), 0), 'BETA_API'
  FROM core.beta_order_latest o WHERE o.present AND NOT EXISTS (
    SELECT 1 FROM core.installment_contract c WHERE c.scheme_id = o.scheme_id AND (c.beta_order_id = o.beta_order_id OR c.bank_contract_id = o.beta_order_id::text))
  UNION ALL
  SELECT 'beta', 'BA-02', 'high', 'قرارداد الماس که در بتا ثبت نیست یا بتا آن را نامعتبر می‌داند', count(*), coalesce(sum(c.total_amount), 0), 'BETA_API'
  FROM core.installment_contract c LEFT JOIN core.beta_order_latest o ON o.scheme_id = c.scheme_id AND o.beta_order_id = c.beta_order_id
  WHERE c.status = 'active' AND ((c.beta_order_id IS NOT NULL AND o.present = false)
        OR (c.beta_order_id IS NULL AND c.bank_contract_id IS NULL AND c.created_at >= (SELECT since FROM api_schemes a WHERE a.scheme_id = c.scheme_id)))
  UNION ALL
  SELECT 'beta', 'BA-03', 'high', 'اختلاف مبلغ کل یا تعداد اقساط قرارداد با بتا', count(*), coalesce(sum(abs(l.total_amount - coalesce(l.beta_amount, l.total_amount))), 0), 'BETA_API'
  FROM core.beta_sale_lineage l
  WHERE l.beta_present AND ((l.beta_amount IS NOT NULL AND l.beta_amount <> l.total_amount)
        OR (l.beta_live_installments IS NOT NULL AND l.beta_live_installments > 0
            AND l.beta_live_installments <> (SELECT count(*) FROM core.installment i WHERE i.contract_id = l.contract_id AND NOT EXISTS (
                  SELECT 1 FROM core.installment_cancellation x WHERE x.installment_id = i.id AND x.reversed_at IS NULL))))
  UNION ALL
  SELECT 'beta', 'BA-04', 'high', 'اختلاف مبلغ یا سررسید قسط با جدول اقساط بتا', count(*), coalesce(sum(abs(amount - beta_amount)), 0), 'BETA_API'
  FROM cmp WHERE NOT coalesce(beta_deleted, false) AND (beta_amount <> amount OR beta_due <> due_date)
  UNION ALL
  SELECT 'beta', 'BA-05', 'high', 'وصول موفق در بتا بدون واریز ثبت‌شده در حساب الماس', count(*), coalesce(sum(beta_amount), 0), 'BETA_API, B-14'
  FROM cmp WHERE beta_settled AND paid_by_bank = 0 AND almas_status NOT IN ('paid_direct', 'cancelled')
    AND coalesce(beta_settle_date, p_as_of) + core.setting_value('beta_deposit_expected_days')::int < p_as_of
  UNION ALL
  SELECT 'beta', 'BA-06', 'medium', 'واریز بانکی ثبت‌شده در الماس برای قسطی که بتا وصول‌نشده می‌داند', count(*), coalesce(sum(paid_by_bank), 0), 'BETA_API'
  FROM cmp WHERE paid_by_bank > 0 AND beta_settled = false AND NOT coalesce(beta_deleted, false)
  UNION ALL
  SELECT 'beta', 'BA-07', 'high', 'وصول ناموفق در بتا (قسط برداشت نشد)', count(*), coalesce(sum(outstanding), 0), 'BETA_API'
  FROM cmp WHERE beta_status = 'Rejected' AND outstanding > 0
  UNION ALL
  SELECT 'beta', 'BA-08', 'medium', 'حذف قسط در بتا بدون لغو در الماس، یا برعکس', count(*), coalesce(sum(amount), 0), 'BETA_API'
  FROM cmp WHERE (beta_deleted AND almas_status <> 'cancelled') OR (almas_status = 'cancelled' AND beta_deleted = false)
  UNION ALL
  SELECT 'beta', 'BA-09', 'high', 'ثبت فروش با نتیجه نامعلوم (باید با شناسه یکتا استعلام شود)', count(*), coalesce(sum(amount), 0), 'BETA_API'
  FROM core.beta_sale_request WHERE status = 'unknown_outcome'
  UNION ALL
  SELECT 'beta', 'BA-10', 'medium', 'فروش ثبت‌شده در بتا که هنوز قرارداد الماس نشده', count(*), coalesce(sum(amount), 0), 'BETA_API'
  FROM core.beta_sale_request WHERE status = 'consumed' AND updated_at::date < p_as_of
  UNION ALL
  SELECT 'beta', 'BA-11', 'high', 'خطای پذیرنده یا دسترسی در آخرین فراخوانی بتا (تفاهم‌نامه، کارمزد، غیرفعال، api-key)', count(*), NULL::numeric, 'BETA_API'
  FROM (SELECT DISTINCT ON (scheme_id) scheme_id, endpoint, coalesce(business_status, http_status) AS code FROM core.beta_api_call
        WHERE outcome <> 'no_response' ORDER BY scheme_id, finished_at DESC, id DESC) z
  WHERE (core.beta_status_meaning(z.endpoint, z.code)).category IN ('acceptor', 'auth')
  UNION ALL
  SELECT 'beta', 'BA-12', 'medium', 'قرارداد Import‌شده که شناسه آن با شناسه فروش API برابر است ولی پیوند آن تأیید نشده', count(*), NULL::numeric, 'BETA_API, U-B5'
  FROM core.beta_order_latest o JOIN core.installment_contract c ON c.scheme_id = o.scheme_id AND c.bank_contract_id = o.beta_order_id::text AND c.beta_order_id IS NULL
  UNION ALL
  SELECT 'beta', 'BA-13', 'high', 'پاسخ بتا که قابل خواندن نبود (قالب پاسخ با سند ۱.۳ فرق دارد؟)', count(*), NULL::numeric, 'BETA_API, D-23'
  FROM core.beta_ingest_error
  UNION ALL
  -- (AG-01 is defined in 022: after D-22 the agent is owed the deal's base amount, not a share of each collection)
  SELECT 'agents', 'AG-02', 'medium', 'طلب ثبت‌شده نماینده که هنوز تسویه نشده', count(*), coalesce(sum(open_amount), 0), 'D-22'
  FROM core.agent_entitlement_status WHERE reversed_at IS NULL AND open_amount > 0
  UNION ALL
  SELECT 'agents', 'AG-03', 'high', 'سهم نماینده بر پایه وصولی که ابطال شده است', count(*), coalesce(sum(e.amount), 0), 'D-22'
  FROM core.agent_entitlement e JOIN core.receipt r ON r.id = e.receipt_id WHERE e.reversed_at IS NULL AND r.reversed_at IS NOT NULL
  UNION ALL
  SELECT 'agents', 'AG-04', 'medium', 'پرداخت به نماینده که به سهم مشخصی تخصیص نیافته', count(*), coalesce(sum(unallocated), 0), 'D-22'
  FROM core.agent_settlement_status WHERE reversed_at IS NULL AND unallocated > 0
  UNION ALL
  SELECT 'agents', 'AG-05', 'high', 'پرداخت ابطال‌نشده به نماینده روی سهمی که ابطال شده', count(DISTINCT a.id), coalesce(sum(a.amount), 0), 'D-22'
  FROM core.agent_settlement_allocation a JOIN core.agent_settlement s ON s.id = a.settlement_id AND s.reversed_at IS NULL
  JOIN core.agent_entitlement e ON e.id = a.entitlement_id AND e.reversed_at IS NOT NULL
  UNION ALL
  SELECT 'agents', 'AG-06', 'info', 'رویداد نمایندگی بدون سند حسابداری (در انتظار D-26)', count(*), coalesce(sum(amount), 0), 'D-26'
  FROM (SELECT amount FROM core.agent_entitlement WHERE reversed_at IS NULL AND journal_entry_id IS NULL
        UNION ALL SELECT amount FROM core.agent_settlement WHERE reversed_at IS NULL AND journal_entry_id IS NULL) z $$;

-- the inbox gains these controls without restating the existing ones
ALTER FUNCTION core.control_inbox(date) RENAME TO control_inbox_v17;
CREATE FUNCTION core.control_inbox(p_as_of date DEFAULT current_date)
RETURNS TABLE (area text, control text, severity text, title text, items bigint, amount numeric, basis text) LANGUAGE sql STABLE AS $$
  SELECT * FROM core.control_inbox_v17(p_as_of) UNION ALL SELECT * FROM core.beta_network_controls(p_as_of) $$;

-- ============ Agent workspace (reads scoped to the user's own agent; nothing central) ============
CREATE FUNCTION core.require_agent(p_user text) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE a int := core.agent_of(p_user);
BEGIN
  IF a IS NULL THEN RAISE EXCEPTION 'permission denied: % is not an agent user', p_user USING ERRCODE = 'insufficient_privilege'; END IF;
  PERFORM core.require_permission(p_user, 'agent.workspace');
  RETURN a;
END $$;

CREATE FUNCTION core.agent_my_sale_requests(p_user text)
RETURNS TABLE (request_id bigint, created_at timestamptz, national_id text, customer_name text, title text, amount numeric, installments int,
               start_year_month text, status text, status_fa text, failure text, contract_id bigint) LANGUAGE sql STABLE AS $$
  SELECT r.id, r.created_at, r.national_id, r.customer_name, r.title, r.amount, r.installment_count, r.start_year_month, r.status,
         CASE r.status WHEN 'draft' THEN 'ثبت اولیه' WHEN 'checked' THEN 'استعلام شد' WHEN 'otp_sent' THEN 'رمز برای مشتری ارسال شد'
              WHEN 'unknown_outcome' THEN 'در حال پیگیری' WHEN 'consumed' THEN 'ثبت شد در بانک' WHEN 'contracted' THEN 'قرارداد فعال'
              WHEN 'failed' THEN 'ناموفق' ELSE 'منصرف‌شده' END, r.failure, r.contract_id
  FROM core.beta_sale_request r WHERE r.agent_id = core.require_agent(p_user) ORDER BY r.created_at DESC $$;

CREATE FUNCTION core.agent_my_cases(p_user text)
RETURNS TABLE (contract_id bigint, customer_name text, national_id text, beta_order_id bigint, total_amount numeric, installments int,
               paid_count bigint, overdue_count bigint, outstanding numeric, next_due date, next_amount numeric) LANGUAGE sql STABLE AS $$
  SELECT l.contract_id, p.name, l.customer_national_id, l.beta_order_id, l.total_amount, l.installment_count, l.paid_count, l.overdue_count,
         l.outstanding_amount,
         (SELECT min(s.due_date) FROM core.installment_status s WHERE s.contract_id = l.contract_id AND s.outstanding > 0),
         (SELECT s.outstanding FROM core.installment_status s WHERE s.contract_id = l.contract_id AND s.outstanding > 0 ORDER BY s.due_date LIMIT 1)
  FROM core.beta_sale_lineage l JOIN core.party p ON p.id = l.party_id
  WHERE l.agent_id = core.require_agent(p_user) ORDER BY l.contract_id DESC $$;

CREATE FUNCTION core.agent_my_customers(p_user text)
RETURNS TABLE (party_id int, name text, national_id text, contracts bigint, outstanding numeric, overdue_count bigint) LANGUAGE sql STABLE AS $$
  SELECT c.party_id, c.customer_name, c.national_id, count(*), sum(c.outstanding), sum(c.overdue_count)
  FROM (SELECT l.party_id, p.name AS customer_name, l.customer_national_id AS national_id, l.outstanding_amount AS outstanding, l.overdue_count
        FROM core.beta_sale_lineage l JOIN core.party p ON p.id = l.party_id WHERE l.agent_id = core.require_agent(p_user)) c
  GROUP BY 1, 2, 3 ORDER BY 2 $$;

-- the agent's own statement: what Almas has recorded as its entitlement and what was paid (no central accounting)
CREATE FUNCTION core.agent_my_statement(p_user text)
RETURNS TABLE (contract_id bigint, basis text, entitled numeric, settled numeric, open_amount numeric, recorded_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT e.contract_id, e.basis, e.amount, e.settled, e.open_amount, e.created_at
  FROM core.agent_entitlement_status e WHERE e.agent_id = core.require_agent(p_user) AND e.reversed_at IS NULL ORDER BY e.created_at DESC $$;

-- ============ Operation catalog: agent scope ============
ALTER TABLE core.operation_catalog ADD COLUMN agent_allowed boolean NOT NULL DEFAULT false;

-- may this user run this operation? agent users: only agent-scoped operations; everyone: the operation's permission
CREATE FUNCTION core.require_operation(p_user text, p_operation text) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE op core.operation_catalog;
BEGIN
  SELECT * INTO op FROM core.operation_catalog WHERE operation = p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown operation %', p_operation; END IF;
  IF core.agent_of(p_user) IS NOT NULL AND NOT op.agent_allowed THEN
    RAISE EXCEPTION 'permission denied: % is not available in the agent workspace', p_operation USING ERRCODE = 'insufficient_privilege'; END IF;
  IF core.agent_of(p_user) IS NULL AND EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = p_user) THEN
    RAISE EXCEPTION 'permission denied: agent user % is inactive', p_user USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

CREATE OR REPLACE FUNCTION core.operations_for(p_user text)
RETURNS TABLE (operation text, kind text, function_signature text, purpose text, permitted boolean, undo text, basis text) LANGUAGE sql STABLE AS $$
  SELECT c.operation, c.kind, c.function_signature, c.purpose,
         (c.permission IS NULL OR core.has_permission(p_user, c.permission))
         AND (c.ai_allowed OR NOT coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false))
         AND (c.agent_allowed OR NOT EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = p_user)),
         c.undo, c.basis
  FROM core.operation_catalog c
  WHERE c.agent_allowed OR NOT EXISTS (SELECT 1 FROM core.sales_agent_user WHERE username = p_user)
  ORDER BY c.kind, c.operation $$;

-- people decide what the bank cannot undo and what pays money out
CREATE OR REPLACE FUNCTION core.require_permission(p_user text, p_perm text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.has_permission(p_user, p_perm) THEN
    RAISE EXCEPTION 'permission denied: user % lacks %', p_user, p_perm USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_perm IN ('period.close', 'period.reopen', 'security.admin', 'settings.change', 'beta.order_change', 'agent.settle')
     AND coalesce((SELECT is_ai_agent FROM core.app_user WHERE username = p_user), false) THEN
    RAISE EXCEPTION 'permission denied: % is reserved for people; an AI agent (%) may prepare, a person decides', p_perm, p_user
      USING ERRCODE = 'insufficient_privilege'; END IF;
END $$;

INSERT INTO core.operation_catalog (operation, kind, function_signature, purpose, permission, effect, undo, basis, ai_allowed, agent_allowed) VALUES
  ('agent.sale_create', 'write', 'core.beta_sale_create(text,text,text,text,numeric,integer,text,text,integer,integer)',
   'start a Beta installment sale for a customer (agent: for itself; staff: for any agent)', NULL,
   'adds a sale request (draft); nothing reaches the bank. Checked inside: agent.workspace (own agent) or beta.sale_manage', 'core.beta_sale_abandon with a reason', 'BetaApiDoc 1.3', true, true),
  ('agent.sale_change', 'write', 'core.beta_sale_change(text,bigint,text,numeric,integer,text)', 'change a sale request before the bank registers it (a sent OTP becomes invalid)',
   NULL, 'updates the draft; audited', 'change again', 'BetaApiDoc 1.3 (OTP bound to data)', true, true),
  ('agent.sale_abandon', 'write', 'core.beta_sale_abandon(text,bigint,text)', 'abandon a sale request not yet registered at the bank', NULL,
   'marks it abandoned; audited', '—', 'BetaApiDoc 1.3', true, true),
  ('agent.sale_precheck', 'read', 'core.beta_sale_precheck(text,bigint,timestamp with time zone)', 'what still blocks this sale before an OTP (credit, months, 8 per month, 36 installments)',
   NULL, 'none', '—', 'BetaApiDoc 1.3', true, true),
  ('agent.my_sale_requests', 'read', 'core.agent_my_sale_requests(text)', 'the agent''s own sale requests and their simple status', NULL, 'none', '—', 'D-22', true, true),
  ('agent.my_cases', 'read', 'core.agent_my_cases(text)', 'the agent''s own contracts: paid, overdue, next installment', NULL, 'none', '—', 'D-22', true, true),
  ('agent.my_customers', 'read', 'core.agent_my_customers(text)', 'the agent''s own customers', NULL, 'none', '—', 'D-22', true, true),
  ('agent.my_statement', 'read', 'core.agent_my_statement(text)', 'what Almas recorded as the agent''s entitlement and paid', NULL, 'none', '—', 'D-22', true, true),
  ('beta.lineage', 'read', 'core.beta_installment_compare(date)', 'every linked installment: Almas status vs the bank''s latest answer', NULL, 'none', '—', 'BETA_API', true, false),
  ('beta.contract_from_order', 'write', 'core.beta_contract_from_order(integer,bigint,text)', 'create the Almas contract from an official Beta order and its installment table',
   'beta.contract_manage', 'adds an active contract with the bank''s schedule, links installments, sets the agent owner (idempotent)',
   'cancel the contract (audited)', 'BetaApiDoc 1.3', true, false),
  ('agent.create', 'write', 'core.agent_create(text,text,integer,text,text,text)', 'register an agent', 'agent.manage', 'adds an agent', 'set status', 'D-22', true, false),
  ('agent.bind_user', 'write', 'core.agent_bind_user(text,integer,text)', 'make a user an agent-workspace user of one agent', 'agent.manage',
   'binds the user; the user can never hold central permissions', '—', 'D-22', true, false),
  ('agent.assign_contract', 'write', 'core.agent_assign_contract(bigint,integer,text,text)', 'change the agent that owns a contract', 'agent.manage',
   'adds an ownership row (history kept)', 'assign again', 'D-22', true, false),
  ('agent.record_entitlement', 'write', 'core.agent_record_entitlement(integer,bigint,text,numeric,text,text,bigint,bigint,text)',
   'record what an agent is entitled to for a sale or a collection, with the rule it comes from', 'agent.entitlement',
   'adds an entitlement (no formula: D-22)', 'core.agent_reverse_entitlement', 'D-22', true, false),
  ('agent.reverse_entitlement', 'write', 'core.agent_reverse_entitlement(bigint,text,text)', 'reverse an unsettled entitlement', 'agent.entitlement',
   'marks it reversed; history kept', '—', 'D-22', true, false),
  ('agent.record_settlement', 'write', 'core.agent_record_settlement(integer,numeric,date,text,integer,text,text,jsonb,text,text)',
   'record a payment to an agent and which entitlements it covers', 'agent.settle', 'adds a settlement and its allocations (atomic)',
   'core.agent_reverse_settlement', 'D-22', false, false),
  ('agent.reverse_settlement', 'write', 'core.agent_reverse_settlement(bigint,text,text)', 'reverse a payment to an agent', 'agent.settle',
   'marks it reversed; allocations stay in history', '—', 'D-22', false, false);
