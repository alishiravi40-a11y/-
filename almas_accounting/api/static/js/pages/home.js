import {api, card, ctx, esc, fmt, jdate, one, op, table, todayIso, j2iso, $} from '../core.js';

// a control's area → where the user fixes it
const FIX = {receivables: 'aging', cheques: 'cheques', sales: 'sales', inventory: 'stock', tax: 'inbox', beta: 'agents', agents: 'agents', legacy: 'agents',
             security: 'users', ledger: 'journal', import: 'imports', coexistence: 'settings'};

export default {
  dashboard: {
    title: 'داشبورد', group: 'home', gate: 'dashboard',
    async render() {
      const [m, inbox] = await Promise.all([op('dashboard', {p_as_of: todayIso}), op('controls.inbox', {p_as_of: todayIso})]);
      const tiles = m.filter(x => x.metric !== 'fiscal_year').map(x =>
        `<a class="tile" href="#/${x.tab}"><span class="tlabel">${esc(x.label)}</span><span class="tvalue">${fmt(x.value)}</span>${x.detail ? `<span class="muted">${esc(x.detail)}</span>` : ''}</a>`).join('');
      const fy = m.find(x => x.metric === 'fiscal_year');
      const urgent = inbox.filter(r => Number(r.items) > 0 && r.severity === 'high').slice(0, 8);
      const quick = [['sales', 'فاکتور فروش'], ['receipt', 'دریافت وجه'], ['payment', 'پرداخت وجه'], ['cheques', 'چک‌ها'], ['voucher', 'سند دستی'], ['purchase', 'فاکتور خرید']]
        .map(([k, t]) => `<a class="btn" href="#/${k}">${t}</a>`).join(' ');
      return `<p class="muted">امروز ${jdate(todayIso)} · سال مالی ${fy ? esc(fy.value) + ' (' + ({open: 'باز', closing: 'در حال بستن', closed: 'بسته'}[fy.detail] || esc(fy.detail)) + ')' : 'تعریف نشده'}</p>
        <div class="tiles">${tiles}</div>` + card('کار سریع', quick) +
        card('نیازمند توجه (شدت زیاد)', table(urgent.map(r => ({...r, href: '#/' + (FIX[r.area] || 'inbox')})), [['area', 'حوزه'], ['title', 'شرح'], ['items', 'تعداد'], ['amount', 'مبلغ']],
             {link: r => r.href.slice(1), empty: 'هیچ کنترل با شدت زیاد باز نیست.'}));
    }
  },
  inbox: {
    title: 'کارتابل کنترل‌ها', group: 'home', gate: 'controls.inbox',
    async render(p) {
      const asOf = p.d ? j2iso(p.d) : todayIso;
      const rows = await op('controls.inbox', {p_as_of: asOf || todayIso});
      const open = rows.filter(r => Number(r.items) > 0), order = ['high', 'medium', 'low', 'info'];
      ctx.after = () => { $('#inboxgo').onclick = () => { location.hash = '#/inbox?d=' + encodeURIComponent($('#inboxd').value); }; };
      return card('', `<div class="row"><label>تا تاریخ <input id="inboxd" value="${jdate(asOf)}" size="10"></label><button class="btn" id="inboxgo">به‌روزرسانی</button></div>
        <p>${fmt(open.length)} کنترل نیازمند توجه · <span class="zero">${fmt(rows.length - open.length)} کنترل بدون مورد</span></p>` +
        table(open.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).map(r => ({...r, fix: FIX[r.area] || 'inbox'})),
              [['area', 'حوزه'], ['control', 'کد'], ['severity', 'شدت'], ['title', 'شرح'], ['items', 'تعداد'], ['amount', 'مبلغ (ریال)'], ['basis', 'پشتوانه']],
              {link: r => '/' + r.fix}) +
        '<p class="muted">روی هر ردیف بزنید تا به صفحه‌ای بروید که مورد در آن رسیدگی می‌شود.</p>');
    }
  },
  document: {
    title: 'سند یک مدرک', group: 'home', menu: false,
    async render(p) {
      const rows = await op('documents.voucher', {p_source: p.source, p_ref: String(p.ref)});
      return card('', rows.length ? `<p><a href="#/entry/${rows[0].entry_id}">نمایش کامل سند ${fmt(rows[0].number)} و منشأ آن</a></p>` +
        table(rows, [['account_code', 'کد'], ['account_name', 'حساب'], ['party_name', 'شخص'], ['debit', 'بدهکار'], ['credit', 'بستانکار'], ['description', 'شرح']], {totals: ['debit', 'credit']})
        : '<p class="muted">این مدرک هنوز سند حسابداری ندارد.</p>');
    }
  },
  ops: {
    title: 'عملیات مجاز من', group: 'admin', agentOk: true,
    async render() {
      const rows = await api('/operations');
      return card('', table(rows.map(r => ({...r, permitted: r.permitted ? 'بله' : 'خیر', kind: r.kind === 'write' ? 'ثبت' : 'مشاهده'})),
        [['operation', 'عملیات'], ['kind', 'نوع'], ['purpose', 'هدف'], ['permitted', 'مجاز'], ['undo', 'راه برگشت'], ['basis', 'پشتوانه']]));
    }
  }
};
