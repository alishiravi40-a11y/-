// Invoices and returns: the list (search by date, number, party) and the whole document as it is printed
import {$, card, ctx, esc, fmt, j2iso, jdate, jmonthStart, latin, one, op, table, todayIso} from '../core.js';

const KIND = {sales: 'فروش', purchase: 'خرید', sales_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید'};
const STATUS = {draft: 'پیش‌نویس', final: 'قطعی'};
const METHOD = {cash: 'نقد', card: 'کارت', bank: 'بانک', cheque: 'چک', transfer: 'حواله'};
const docKind = k => (k === 'sales_return' || k === 'purchase_return') ? 'return' : k;

// words for an amount in rials, as written under an invoice total
const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'], TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'],
      TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'], HUND = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'],
      SCALE = ['', 'هزار', 'میلیون', 'میلیارد', 'هزار میلیارد'];
function three(n) { const h = Math.floor(n / 100), t = n % 100, parts = [];
  if (h) parts.push(HUND[h]);
  if (t >= 10 && t < 20) parts.push(TEENS[t - 10]); else { if (t >= 20) parts.push(TENS[Math.floor(t / 10)]); if (t % 10 && !(t >= 10 && t < 20)) parts.push(ONES[t % 10]); }
  return parts.join(' و '); }
export function words(v) {
  let n = Math.round(Math.abs(Number(v) || 0)); if (!n) return 'صفر';
  const groups = []; for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) { const g = n % 1000; if (g) groups.unshift(three(g) + (SCALE[i] ? ' ' + SCALE[i] : '')); }
  return groups.join(' و ');
}

export default {
  invoices: {
    title: 'فهرست فاکتورها', group: 'daily', gate: 'invoices.list',
    async render(p) {
      const kind = p.kind || 'all', from = p.from ? j2iso(p.from) : jmonthStart(todayIso), to = p.to ? j2iso(p.to) : todayIso;
      const rows = await op('invoices.list', {p_kind: kind, p_from: from, p_to: to, p_query: p.q || null, p_limit: 500});
      ctx.after = () => { $('#vgo').onclick = () => location.hash = `#/invoices?kind=${$('#vk').value}&from=${encodeURIComponent($('#vf').value)}&to=${encodeURIComponent($('#vt').value)}&q=${encodeURIComponent(latin($('#vq').value))}`; };
      const opt = [['all', 'همه'], ['sales', 'فروش'], ['purchase', 'خرید'], ['return', 'برگشت']].map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('');
      return card('', `<div class="row"><label>نوع <select id="vk">${opt}</select></label><label>از <input id="vf" value="${jdate(from)}" size="10"></label>
          <label>تا <input id="vt" value="${jdate(to)}" size="10"></label><label>شماره یا نام شخص <input id="vq" value="${esc(p.q || '')}" size="18"></label>
          <button class="btn" id="vgo">نمایش</button><a class="btn" href="#/sales">+ فاکتور فروش</a><a class="btn" href="#/purchase">+ فاکتور خرید</a></div>` +
        table(rows.map(r => ({...r, k: KIND[r.kind] || r.kind, st: STATUS[r.status] || r.status})),
          [['k', 'نوع'], ['number', 'شماره'], ['doc_date', 'تاریخ'], ['party_name', 'شخص'], ['total', 'مبلغ'], ['st', 'وضعیت']],
          {link: r => `/invoice/${r.document_id}?kind=${docKind(r.kind)}`, totals: ['total'], empty: 'در این بازه فاکتوری نیست.'}));
    }
  },
  invoice: {
    title: 'فاکتور', group: 'daily', menu: false, gate: 'invoices.detail',
    async render(p) {
      const d = one(await op('invoices.detail', {p_kind: p.kind || 'sales', p_id: Number(p.id)}));
      if (!d) return card('', '<p class="err">فاکتور پیدا نشد.</p>');
      const h = d.header, pa = d.party || {}, t = d.totals, isRet = d.kind.endsWith('return');
      const title = isRet ? KIND[d.kind] : `فاکتور ${KIND[d.kind]}`;
      const lines = table(d.lines.map((l, i) => ({...l, n: i + 1})), [['n', 'ردیف'], ['item_code', 'کد کالا'], ['item_name', 'شرح کالا'], ['unit', 'واحد'],
          ['quantity', 'تعداد'], ['unit_price', 'بهای واحد'], ['discount', 'تخفیف'], ['vat', 'مالیات و عوارض'], ['amount', 'مبلغ']], {totals: ['quantity', 'discount', 'vat', 'amount'], noExport: true});
      const totals = `<table class="totals"><tbody>
          <tr><td>جمع ناخالص</td><td class="num">${fmt(t.gross)}</td></tr><tr><td>تخفیف</td><td class="num">${fmt(t.discount)}</td></tr>
          ${Number(t.vat) ? `<tr><td>مالیات و عوارض</td><td class="num">${fmt(t.vat)}</td></tr>` : ''}
          ${Number(t.extra_cost) ? `<tr><td>هزینه‌های فاکتور</td><td class="num">${fmt(t.extra_cost)}</td></tr>` : ''}
          <tr><th>مبلغ قابل پرداخت</th><th class="num">${fmt(t.net)}</th></tr>
          ${isRet ? '' : `<tr><td>پرداخت‌شده همان لحظه</td><td class="num">${fmt(t.paid)}</td></tr><tr><td>مانده</td><td class="num">${fmt(Number(t.net) - Number(t.paid))}</td></tr>`}
        </tbody></table><p>به حروف: ${words(t.net)} ریال</p>`;
      const pays = d.payments.length ? '<h3>دریافت و پرداخت</h3>' + table(d.payments.map(x => ({...x, m: METHOD[x.method] || x.method})),
          [['m', 'روش'], ['account', 'صندوق یا بانک'], ['amount', 'مبلغ'], ['reference', 'مرجع']], {noExport: true}) : '';
      const links = `<div class="row noprint"><button class="btn primary" onclick="window.print()">چاپ</button>
          ${d.entry ? `<a class="btn" href="#/entry/${d.entry.entry_id}">سند حسابداری ${fmt(d.entry.number)}</a>` : ''}
          ${isRet && h.original_invoice ? `<a class="btn" href="#/invoice/${h.original_invoice}?kind=${d.kind === 'sales_return' ? 'sales' : 'purchase'}">فاکتور اصلی</a>` : ''}
          ${!isRet && h.status === 'final' ? `<a class="btn" href="#/ret?kind=${d.kind}&q=${h.number}">ثبت برگشت</a>` : ''}
          ${(d.returns || []).map(r => `<a class="btn" href="#/invoice/${r.return_id}?kind=return">برگشت ${fmt(r.return_id)}</a>`).join(' ')}
          <a class="btn" href="#/invoices">فهرست فاکتورها</a></div>`;
      return links + `<article class="doc"><h1>${title}${h.status === 'draft' ? ' (پیش‌نویس — قطعی نشده)' : ''}</h1>
        <div class="meta"><span>شماره: <b>${fmt(h.number)}</b></span><span>تاریخ: <b>${jdate(h.invoice_date)}</b></span>
          ${isRet ? `<span>فاکتور اصلی: ${fmt(h.original_number)}</span><span>علت: ${esc(h.reason || '—')}</span>` : ''}
          ${h.supplier_invoice_no ? `<span>شماره فاکتور فروشنده: ${esc(h.supplier_invoice_no)}</span>` : ''}</div>
        <div class="meta"><span>${d.kind.startsWith('sales') ? 'خریدار' : 'فروشنده'}: <b>${esc(pa.name || '—')}</b></span>
          ${pa.national_id ? `<span>شناسه/کد ملی: ${esc(pa.national_id)}</span>` : ''}${pa.economic_code ? `<span>کد اقتصادی: ${esc(pa.economic_code)}</span>` : ''}
          ${pa.mobile ? `<span>تلفن: ${esc(pa.mobile)}</span>` : ''}</div>
        ${lines}${totals}${pays}
        <div class="sign"><div>امضای ${d.kind.startsWith('sales') ? 'فروشنده' : 'خریدار'}</div><div>امضای ${d.kind.startsWith('sales') ? 'خریدار' : 'فروشنده'}</div></div>
        <p class="muted">ثبت: ${esc(h.created_by || '')}${h.finalized_by ? ' · قطعی: ' + esc(h.finalized_by) : ''}</p></article>`;
    }
  }
};
