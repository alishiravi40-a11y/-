// Shared UI layer. The page holds NO accounting rule: every step is a catalogued operation of the core, called through the API.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// ---- numbers ----
export const isNum = v => /^-?\d+(\.\d+)?$/.test(String(v));
export const fmt = v => v === null || v === undefined || v === '' ? '—' : (isNum(v) ? Number(v).toLocaleString('fa-IR') : esc(v));
export const FA = '۰۱۲۳۴۵۶۷۸۹';
export const latin = s => String(s ?? '').replace(/[۰-۹]/g, d => FA.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬،]/g, '');
export const num = id => { const v = latin($('#' + id).value).trim(); return v === '' ? null : Number(v); };

// ---- Jalali dates: stored in the standard calendar, entered and shown in Jalali (the browser's Persian calendar is the reference) ----
const jparts = d => { const p = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'}).formatToParts(d);
                      const g = t => Number(p.find(x => x.type === t).value); return [g('year'), g('month'), g('day')]; };
export const jdate = iso => { if (!iso) return '—'; try { const [y, m, d] = jparts(new Date(String(iso).slice(0, 10) + 'T00:00:00Z'));
  return `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`.replace(/\d/g, x => FA[x]); } catch (e) { return iso; } };
export function j2iso(text) {
  const m = latin(text).trim().match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/); if (!m) return null;
  const [jy, jm, jd] = m.slice(1).map(Number); if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const guess = Date.UTC(jy + 621, 2, 20) + ((jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd - 1) * 864e5;
  for (let k = -3; k <= 3; k++) { const d = new Date(guess + k * 864e5); const [y, mm, dd] = jparts(d);
    if (y === jy && mm === jm && dd === jd) return d.toISOString().slice(0, 10); }
  return null;
}
export const todayIso = new Date().toISOString().slice(0, 10);
export const jyear = iso => latin(jdate(iso)).slice(0, 4);
export const jmonthStart = iso => { const t = latin(jdate(iso)); return j2iso(t.slice(0, 8) + '01'); };
export const dateInput = (id, label = 'تاریخ', value = todayIso) =>
  `<label>${label} <input id="${id}" class="jd" value="${jdate(value)}" size="10" placeholder="۱۴۰۵/۰۱/۰۱" inputmode="numeric"></label>`;
export function readDate(id) { const iso = j2iso($('#' + id).value); if (!iso) throw new Error('تاریخ شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۵).'); return iso; }

// ---- session and API ----
export const session = {user: '', token: '', agent: false, ops: new Map()};
try { session.user = sessionStorage.getItem('almas_user') || ''; session.token = sessionStorage.getItem('almas_token') || ''; } catch (e) {}
export const keep = (k, v) => { try { v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); } catch (e) {} };
export async function api(path, body) {
  const headers = {'Content-Type': 'application/json', ...(session.token ? {Authorization: 'Bearer ' + session.token} : {'X-Almas-User': session.user})};
  const r = await fetch(path, {method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined});
  let j; try { j = await r.json(); } catch (e) { j = {detail: r.statusText}; }
  if (r.status === 401 && session.token) { session.token = ''; keep('almas_token', ''); }
  if (!r.ok) { const e = new Error(persian(j.detail || r.status)); e.status = r.status; e.raw = j.detail; throw e; }
  return j;
}
export const op = (name, args = {}, note) => api('/operations/' + name, {args, note}).then(j => j.rows);
export const one = rows => rows.length ? Object.values(rows[0])[0] : null;
export const can = name => session.ops.get(name) === true;

// database messages are English for developers; people get Persian for the common ones
export function persian(msg) {
  const m = String(msg);
  const map = [[/permission denied: user .* lacks (\S+)/, 'مجوز «$1» را ندارید'], [/reserved for people/, 'این کار فقط با تصمیم انسان مجاز است'],
    [/not balanced/, 'جمع بدهکار و بستانکار برابر نیست'], [/requires a party/, 'این حساب شخص لازم دارد'], [/is not a leaf/, 'فقط حساب جزء قابل ثبت است'],
    [/period (\S+) is closed/, 'دوره $1 بسته است'], [/negative stock|stock would become negative|negative/, 'موجودی کافی نیست (موجودی منفی مجاز نیست)'],
    [/already reversed/, 'این سند قبلاً ابطال شده است'], [/a reason is required/, 'علت لازم است'], [/no period for/, 'برای این تاریخ دوره مالی تعریف نشده است'],
    [/duplicate key/, 'این مورد قبلاً ثبت شده است']];
  for (const [re, fa] of map) { const x = m.match(re); if (x) return fa.replace(/\$(\d)/g, (_, i) => x[Number(i)] ?? ''); }
  return m;
}

// ---- tables ----
const AREA = {sales: 'فروش', receivables: 'مطالبات', cheques: 'چک', inventory: 'موجودی', tax: 'مؤدیان', beta: 'اقساط بتا', ledger: 'دفتر', agents: 'نمایندگان',
              legacy: 'میراث هلو', security: 'امنیت', import: 'ورود Backup'};
const SEV = {high: 'زیاد', medium: 'متوسط', low: 'کم', info: 'اطلاع'};
// the posting rules label every generated line with a role code; people read its Persian name
const ROLE = {party_invoice: 'فاکتور', party_settlement: 'دریافت/پرداخت همان لحظه', settlement_instrument: 'وسیله تسویه', counter: 'طرف حساب', money_in: 'واریز',
  money_out: 'برداشت', fee: 'کارمزد', fee_paid: 'پرداخت کارمزد', cash_discount: 'تخفیف نقدی', sales: 'فروش', sales_return: 'برگشت از فروش', purchase: 'خرید',
  purchase_return: 'برگشت از خرید', vat: 'مالیات بر ارزش افزوده', waste: 'ضایعات', line: 'ردیف فاکتور', extra_cost: 'هزینه‌های فاکتور'};
const EVENT = {received: 'دریافت چک', deposited_for_collection: 'خواباندن به بانک', collected: 'وصول چک', returned_from_bank: 'برگشت از بانک', returned_to_payer: 'عودت چک',
  endorsed_to_party: 'واگذاری چک', cashed: 'نقد شدن چک', issued: 'صدور چک', paid_by_bank: 'پاس شدن چک', opening_position: 'چک انتقالی'};
export const role = d => { if (!d || !/^[a-z_:]+$/.test(d)) return d; const [a, b] = d.split(':');
  if (b) return (a === 'cheque_to' ? 'به: ' : 'از: ') + (EVENT[b] || b); return ROLE[a] || d; };
const TEXT = new Set(['code', 'account_code', 'control', 'operation', 'basis', 'function_signature', 'national_id', 'buyer_national_id', 'customer_national_id',
  'bank_ref', 'ref', 'agent_code', 'proposed_agent_code', 'evidence_ref', 'beta_order_id', 'mobile', 'username', 'key', 'period', 'fiscal_year', 'bank_code', 'parent_code']);
const DATE = new Set(['oldest_open_due', 'since', 'effective_date', 'invoice_date', 'due_date', 'sale_date', 'registered_at', 'next_due', 'declared_at', 'created_at',
  'value_date', 'starts_on', 'ends_on', 'last_activity', 'last_movement', 'last_login', 'date', 'updated_at']);
export function table(rows, cols, opts = {}) {
  if (!rows || !rows.length) return `<p class="zero">${opts.empty || 'موردی نیست.'}</p>`;
  const cell = (c, r) => { const v = r[c[0]];
    if (c[2] === 'html') return `<td>${v ?? ''}</td>`;
    if (c[0] === 'area') return `<td>${AREA[v] || esc(v)}</td>`;
    if (c[0] === 'severity') return `<td class="sev ${esc(v)}">${SEV[v] || esc(v)}</td>`;
    if (TEXT.has(c[0])) return `<td>${esc(v ?? '—')}</td>`;
    if (DATE.has(c[0])) return `<td>${v ? jdate(String(v).slice(0, 10)) : '—'}</td>`;
    if (typeof v === 'boolean') return `<td>${v ? 'بله' : 'خیر'}</td>`;
    if (c[0] === 'description') return `<td>${esc(role(v) ?? '—')}</td>`;
    return `<td class="${isNum(v) ? 'num' : ''}">${fmt(v)}</td>`; };
  const link = opts.link ? r => ` class="link" data-href="${opts.link(r)}"` : () => '';
  let body = rows.map(r => `<tr${link(r)}>` + cols.map(c => cell(c, r)).join('') + '</tr>').join('');
  if (opts.totals) { const t = {}; opts.totals.forEach(k => t[k] = rows.reduce((a, r) => a + Number(r[k] || 0), 0));
    body += '<tr class="total">' + cols.map((c, i) => i === 0 ? '<td>جمع</td>' : `<td class="num">${k(opts.totals, c[0]) ? fmt(t[c[0]]) : ''}</td>`).join('') + '</tr>'; }
  return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const k = (arr, x) => arr.includes(x);
document.addEventListener('click', e => { const tr = e.target.closest('tr.link'); if (tr && !e.target.closest('button,input,select,a')) location.hash = tr.dataset.href; });
export const options = (rows, key, label, sel) => rows.map(r => `<option value="${esc(r[key])}"${String(r[key]) === String(sel) ? ' selected' : ''}>${esc(r[label])}</option>`).join('');
export const msg = (id, text, ok) => { const el = $('#' + id); if (el) el.innerHTML = `<p class="${ok ? 'zero' : 'err'}">${text}</p>`; };
export const guard = (id, fn) => async (...a) => { try { await fn(...a); } catch (e) { msg(id, esc(e.message)); } };
export const card = (title, body) => `<section class="card">${title ? `<h2>${title}</h2>` : ''}${body}</section>`;
export const btn = (label, onclick, cls = '') => `<button class="btn ${cls}" onclick="${onclick}">${label}</button>`;

// ---- quick lookups (people, goods) ----
export const picked = {};
export function lookup(inputId, opName, key, label, extra = {}) {
  const inp = $('#' + inputId); if (!inp) return;
  const listId = inputId + '_list';
  if (!$('#' + listId)) inp.insertAdjacentHTML('afterend', `<datalist id="${listId}"></datalist>`);
  inp.setAttribute('list', listId);
  inp.oninput = async () => {
    const q = inp.value.trim(); picked[inputId] = null; if (q.length < 2) return;
    const rows = await op(opName, {p_query: latin(q), ...extra});
    $('#' + listId).innerHTML = rows.map(r => `<option value="${esc(r[label])}">`).join('');
    const hit = rows.find(r => String(r[label]) === q); picked[inputId] = hit ? hit[key] : null; picked[inputId + '_row'] = hit || null;
  };
}
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

// the current page registers work to do once its HTML is in the DOM (wiring buttons)
export const ctx = {after: null};
