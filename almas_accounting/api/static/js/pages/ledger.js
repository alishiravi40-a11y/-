import {$, $$, card, ctx, dateInput, esc, fmt, j2iso, jdate, jyear, jmonthStart, latin, lookup, msg, newKey, num, one, op, options, picked, readDate, table, todayIso, can} from '../core.js';
import {action} from './documents.js';

const SOURCE = {manual: 'سند دستی', holoo: 'منتقل‌شده از هلو', treasury: 'دریافت/پرداخت', cheque: 'چک', sales_invoice: 'فاکتور فروش', purchase_invoice: 'فاکتور خرید',
                return: 'برگشت', closing: 'بستن سال', opening: 'افتتاحیه'};
const KIND = {normal: 'عادی', adjustment: 'اصلاحی', reversal: 'ابطال', opening: 'افتتاحیه', closing: 'اختتامیه'};

export default {
  parties: {
    title: 'اشخاص', group: 'books', gate: 'parties.list',
    async render(p) {
      const rows = await op('parties.list', {p_query: p.q || null, p_limit: 100});
      ctx.after = () => { $('#pq').onkeydown = e => { if (e.key === 'Enter') location.hash = '#/parties?q=' + encodeURIComponent(latin($('#pq').value)); }; };
      return card('', `<div class="row"><label>جست‌وجو (نام، کد ملی، موبایل) <input id="pq" value="${esc(p.q || '')}" size="28"></label>
          ${can('parties.save') ? '<a class="btn primary" href="#/party/new">+ شخص تازه</a>' : ''}</div>` +
        table(rows, [['name', 'نام'], ['national_id', 'کد ملی'], ['mobile', 'موبایل'], ['balance', 'مانده (مثبت = بدهکار به الماس)'], ['last_activity', 'آخرین گردش']],
              {link: r => '/party/' + r.party_id}));
    }
  },
  party: {
    title: 'پرونده شخص', group: 'books', menu: false, gate: 'parties.profile',
    async render(p) {
      const isNew = p.id === 'new', pr = isNew ? {party: {}} : await op('parties.profile', {p_party: Number(p.id)}).then(one);
      const x = pr.party || {};
      ctx.after = () => action('psave', 'pmsg', async () => {
        const id = one(await op('parties.save', {p_party: isNew ? null : Number(p.id), p_name: $('#pname').value, p_national_id: latin($('#pnid').value) || null,
                         p_mobile: latin($('#pmob').value) || null, p_economic_code: latin($('#peco').value) || null, p_legal_kind: $('#pkind').value}));
        location.hash = '#/party/' + id;
      });
      const form = `<div class="row"><label>نام <input id="pname" value="${esc(x.name || '')}" size="26"></label>
          <label>نوع <select id="pkind"><option value="person">حقیقی</option><option value="company"${x.legal_kind === 'company' ? ' selected' : ''}>حقوقی</option></select></label>
          <label>کد ملی / شناسه ملی <input id="pnid" value="${esc(x.national_id || '')}" size="12" ${x.national_id ? 'disabled title="کد ملی تأییدشده تغییر نمی‌کند (D-18)"' : ''}></label>
          <label>موبایل <input id="pmob" value="${esc(x.mobile || '')}" size="12"></label><label>کد اقتصادی <input id="peco" value="${esc(x.economic_code || '')}" size="12"></label>
          ${can('parties.save') ? '<button class="btn primary" id="psave">ذخیره</button>' : ''}</div><div id="pmsg"></div>`;
      if (isNew) return card('شخص تازه', form);
      const r = pr.roles || {};
      const roles = [r.contracts_as_customer > 0 ? `مشتری بتا (${fmt(r.contracts_as_customer)} قرارداد)` : '', r.sales_agent_id ? 'نماینده فروش' : '',
                     r.registrar_identities > 0 ? 'ثبت‌کننده پنل بتا' : ''].filter(Boolean).join('، ') || '—';
      const fy = jyear(todayIso);
      return card(esc(x.name), form + `<p class="muted">نقش‌ها: ${roles} · پرونده ${fmt(x.id)}${x.merged_into_id ? ' · ادغام‌شده در ' + fmt(x.merged_into_id) : ''}</p>`) +
        card('مانده به تفکیک حساب', table(pr.accounts.map(a => ({...a, href: `/ledger?code=${a.account_code}&party=${x.id}&y=${fy}`})),
          [['account_code', 'حساب'], ['account_name', 'نام'], ['balance', 'مانده']], {link: a => a.href, totals: ['balance']}) +
          (can('ar.allocate') ? `<a class="btn" href="#/settle?party=${x.id}">تطبیق حساب این شخص</a>` : '')) +
        card('چک‌های باز', table(pr.cheques, [['direction', 'نوع'], ['number', 'شماره'], ['amount', 'مبلغ'], ['due_date', 'سررسید'], ['state', 'وضعیت']])) +
        (pr.beta_contracts.length ? card('قراردادهای بتا', table(pr.beta_contracts, [['contract_id', 'قرارداد'], ['total', 'مبلغ کل'], ['outstanding', 'مانده'], ['overdue', 'قسط معوق']])) : '') +
        card('آخرین گردش‌ها', table(pr.recent, [['date', 'تاریخ'], ['number', 'سند'], ['description', 'شرح'], ['debit', 'بدهکار'], ['credit', 'بستانکار']], {link: e => '/entry/' + e.entry_id}));
    }
  },
  accounts: {
    title: 'سرفصل حساب‌ها', group: 'books', gate: 'accounts.tree',
    async render(p) {
      const rows = await op('accounts.tree', {p_as_of: null});
      const lvl = Number(p.level || 2), show = rows.filter(r => r.level <= lvl && (!p.q || r.name.includes(p.q) || r.code.startsWith(p.q)));
      const fy = jyear(todayIso);
      ctx.after = () => {
        $('#alevel').onchange = () => location.hash = `#/accounts?level=${$('#alevel').value}`;
        action('acreate', 'amsg', async () => {
          await op('accounts.create', {p_parent_code: latin($('#apar').value), p_code: latin($('#acode').value), p_name: $('#aname').value,
                                       p_nature: $('#anat').value, p_requires_party: $('#aparty').checked});
          msg('amsg', 'حساب ساخته شد.', true); window.dispatchEvent(new Event('almas:refresh'));
        });
      };
      return card('', `<div class="row"><label>تا سطح <select id="alevel">${[1, 2, 3, 4].map(l => `<option ${l === lvl ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>` +
        table(show.map(r => ({...r, name: '— '.repeat(r.level - 1) + r.name})), [['code', 'کد'], ['name', 'نام'], ['balance', 'مانده'], ['requires_party', 'شخص‌دار']],
              {link: r => `/ledger?code=${r.code}&y=${fy}`})) +
        (can('accounts.create') ? card('حساب تازه', `<div class="row"><label>کد حساب مادر <input id="apar" size="10"></label><label>کد <input id="acode" size="12"></label>
          <label>نام <input id="aname" size="22"></label><label>ماهیت <select id="anat"><option value="debit">بدهکار</option><option value="credit">بستانکار</option><option value="either">هر دو</option></select></label>
          <label><input type="checkbox" id="aparty"> شخص‌دار</label><button class="btn" id="acreate">ساخت</button></div><div id="amsg"></div>`) : '');
    }
  },
  journal: {
    title: 'اسناد حسابداری', group: 'books', gate: 'journal.list',
    async render(p) {
      const from = p.from ? j2iso(p.from) : jmonthStart(todayIso), to = p.to ? j2iso(p.to) : todayIso;
      const rows = await op('journal.list', {p_from: from, p_to: to, p_query: p.q || null, p_source: p.source || null, p_limit: 300});
      ctx.after = () => { $('#jgo').onclick = () => location.hash = `#/journal?from=${encodeURIComponent($('#jfrom').value)}&to=${encodeURIComponent($('#jto').value)}&q=${encodeURIComponent(latin($('#jq').value))}&source=${$('#jsrc').value}`; };
      return card('', `<div class="row"><label>از <input id="jfrom" value="${jdate(from)}" size="10"></label><label>تا <input id="jto" value="${jdate(to)}" size="10"></label>
          <label>شماره یا شرح <input id="jq" value="${esc(p.q || '')}" size="16"></label>
          <label>منشأ <select id="jsrc"><option value="">همه</option>${Object.entries(SOURCE).map(([k, v]) => `<option value="${k}" ${p.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <button class="btn" id="jgo">نمایش</button> ${can('journal.post_manual') ? '<a class="btn primary" href="#/voucher">+ سند دستی</a>' : ''}</div>` +
        table(rows.map(r => ({...r, src: SOURCE[r.source] || r.source, k: KIND[r.kind] || r.kind, rev: r.reversed ? 'ابطال‌شده' : ''})),
          [['number', 'شماره'], ['effective_date', 'تاریخ'], ['description', 'شرح'], ['src', 'منشأ'], ['k', 'نوع'], ['total', 'مبلغ'], ['rev', ''], ['created_by', 'ثبت‌کننده']],
          {link: r => '/entry/' + r.entry_id}));
    }
  },
  voucher: {
    title: 'سند دستی', group: 'daily', gate: 'journal.post_manual',
    async render() {
      const key = newKey(); const lines = [{}, {}];
      ctx.after = () => {
        const draw = () => {
          $('#vlines').innerHTML = `<table><thead><tr><th>حساب (کد)</th><th>شخص</th><th>بدهکار</th><th>بستانکار</th><th>شرح</th><th></th></tr></thead><tbody>` +
            lines.map((l, i) => `<tr><td><input data-i="${i}" data-f="account_code" value="${esc(l.account_code || '')}" size="12"></td>
              <td><input id="vp${i}" data-i="${i}" data-f="party_name" value="${esc(l.party_name || '')}" size="18"></td>
              <td><input data-i="${i}" data-f="debit" value="${esc(l.debit || '')}" inputmode="numeric" size="12"></td>
              <td><input data-i="${i}" data-f="credit" value="${esc(l.credit || '')}" inputmode="numeric" size="12"></td>
              <td><input data-i="${i}" data-f="description" value="${esc(l.description || '')}" size="18"></td>
              <td><button class="btn" data-rm="${i}">×</button></td></tr>`).join('') + '</tbody></table>';
          $$('#vlines input').forEach(inp => { inp.oninput = () => { lines[inp.dataset.i][inp.dataset.f] = inp.value; sum(); }; });
          lines.forEach((l, i) => lookup('vp' + i, 'parties.find', 'party_id', 'name'));
          $$('[data-rm]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.rm), 1); draw(); sum(); });
        };
        const sum = () => { const d = lines.reduce((a, l) => a + Number(latin(l.debit || 0)), 0), c = lines.reduce((a, l) => a + Number(latin(l.credit || 0)), 0);
          $('#vsum').innerHTML = `بدهکار ${fmt(d)} · بستانکار ${fmt(c)} · ${d === c && d > 0 ? '<span class="zero">تراز است</span>' : `<span class="err">اختلاف ${fmt(d - c)}</span>`}`; };
        $('#vadd').onclick = () => { lines.push({}); draw(); };
        draw(); sum();
        action('vsave', 'vmsg', async () => {
          const body = lines.filter(l => l.account_code).map((l, i) => ({account_code: latin(l.account_code), party_id: picked['vp' + lines.indexOf(l)] || null,
            debit: Number(latin(l.debit || 0)) || null, credit: Number(latin(l.credit || 0)) || null, description: l.description || null}));
          const id = one(await op('journal.post_manual', {p_date: readDate('vdate'), p_description: $('#vdesc').value, p_lines: body, p_idempotency_key: key, p_kind: $('#vkind').value}));
          location.hash = '#/entry/' + id;
        });
      };
      return card('', `<div class="row">${dateInput('vdate')}<label>شرح سند <input id="vdesc" size="40"></label>
          <label>نوع <select id="vkind"><option value="normal">عادی</option><option value="adjustment">اصلاحی (در دوره در حال بستن هم پذیرفته می‌شود)</option></select></label></div><div id="vlines"></div>
        <div class="row"><button class="btn" id="vadd">+ ردیف</button><span id="vsum"></span><button class="btn primary" id="vsave">ثبت سند</button></div><div id="vmsg"></div>
        <p class="muted">سند فقط وقتی ثبت می‌شود که تراز باشد، دوره باز باشد و حساب شخص‌دار شخص داشته باشد. سند ثبت‌شده ویرایش یا حذف نمی‌شود؛ اصلاح با ابطال است.</p>`);
    }
  },
  entry: {
    title: 'سند حسابداری', group: 'books', menu: false, gate: 'journal.detail',
    heading: p => 'سند حسابداری',
    async render(p) {
      const d = one(await op('journal.detail', {p_entry: Number(p.id)}));
      if (!d) return '<p class="err">سند پیدا نشد.</p>';
      const e = d.entry, o = d.origin || {};
      const origin = o.kind === 'holoo_voucher'
        ? `منتقل‌شده از هلو: پایگاه ${esc(o.source_db)}، سند هلو ${fmt(o.holoo_voucher)}، وضعیت ${esc(o.status)}، اولین Backup ${esc((o.backup_sha256 || '').slice(0, 12))}…`
        : o.kind ? `${SOURCE[o.kind] || esc(o.kind)} — مرجع ${esc(o.ref)} — ثبت ${esc(o.posted_by)}` : (SOURCE[e.source] || esc(e.source));
      const docLink = ['sales_invoice', 'purchase_invoice', 'return'].includes(o.kind) ? ` · <a href="#/document?source=${o.kind}&ref=${esc(o.ref)}">مدرک</a>` : '';
      ctx.after = () => action('rev', 'emsg', async () => {
        const reason = prompt('علت ابطال این سند:'); if (!reason) return;
        const nid = one(await op('journal.reverse', {p_entry: e.id, p_date: readDate('revdate'), p_reason: reason}));
        location.hash = '#/entry/' + nid;
      });
      const canRev = can('journal.reverse') && !d.reversed_by && ['manual', 'treasury'].includes(e.source) && ['normal', 'adjustment'].includes(e.kind);
      return card(`سند ${fmt(e.number)} — ${jdate(e.effective_date)}`,
          `<p>${esc(e.description || '')}</p><p class="muted">نوع: ${KIND[e.kind] || e.kind} · سال ${esc(e.fiscal_year)} دوره ${esc(e.period)} · ثبت‌کننده ${esc(e.created_by)} در ${esc(String(e.recorded_at).slice(0, 16))}</p>
           <p><b>منشأ:</b> ${origin}${docLink}</p>
           ${d.reverses ? `<p>این سند ابطال <a href="#/entry/${d.reverses}">سند دیگری</a> است. علت: ${esc(e.reason)}</p>` : ''}
           ${d.reversed_by ? `<p class="err">این سند با <a href="#/entry/${d.reversed_by}">سند ابطال</a> خنثی شده است.</p>` : ''}` +
          table(d.lines.map(l => ({...l, href: l.party_id ? `/party/${l.party_id}` : `/ledger?code=${l.account_code}&y=${e.fiscal_year}`})),
            [['line_no', 'ردیف'], ['account_code', 'کد'], ['account_name', 'حساب'], ['party_name', 'شخص'], ['debit', 'بدهکار'], ['credit', 'بستانکار'], ['description', 'شرح']],
            {link: l => l.href, totals: ['debit', 'credit']}) +
          (canRev ? `<div class="row">${dateInput('revdate', 'تاریخ ابطال')}<button class="btn danger" id="rev">ابطال سند</button></div>` : '') + '<div id="emsg"></div>') +
        card('سابقه', table(d.audit, [['at', 'زمان'], ['actor', 'کاربر'], ['action', 'عمل'], ['reason', 'علت']], {empty: 'سابقه‌ای جز ثبت نیست.'}));
    }
  },
  ledger: {
    title: 'دفتر حساب و شخص', group: 'reports', gate: 'ledger.by_code',
    async render(p) {
      const y = p.y || jyear(todayIso);
      const years = await op('years.list');
      const fy = years.find(x => x.code === y) || years[0];
      if (!fy) return '<p class="muted">سال مالی تعریف نشده است.</p>';
      const from = p.from ? j2iso(p.from) : fy.starts_on, to = p.to ? j2iso(p.to) : fy.ends_on;
      ctx.after = () => {
        lookup('lparty', 'parties.find', 'party_id', 'name');
        $('#lgo').onclick = () => location.hash = `#/ledger?y=${$('#ly').value}&code=${latin($('#lcode').value)}&party=${picked.lparty || p.party || ''}&from=${encodeURIComponent($('#lfrom').value)}&to=${encodeURIComponent($('#lto').value)}`;
      };
      let out = card('', `<div class="row"><label>سال <select id="ly">${options(years, 'code', 'code', fy.code)}</select></label><label>کد حساب <input id="lcode" value="${esc(p.code || '')}" size="12"></label>
        <label>شخص (اختیاری) <input id="lparty" size="22"></label><label>از <input id="lfrom" value="${jdate(from)}" size="10"></label><label>تا <input id="lto" value="${jdate(to)}" size="10"></label>
        <button class="btn" id="lgo">نمایش</button></div>`);
      if (!p.code) return out + '<p class="muted">کد حساب را وارد کنید (یا از تراز یا پرونده شخص روی یک حساب بزنید).</p>';
      const rows = await op('ledger.by_code', {p_year: fy.code, p_code: p.code, p_party: p.party ? Number(p.party) : null, p_from: from, p_to: to});
      return out + card(`دفتر ${esc(p.code)}${p.party ? ' — شخص ' + esc(p.party) : ''}`,
        table(rows, [['effective_date', 'تاریخ'], ['number', 'سند'], ['account_code', 'حساب'], ['party_name', 'شخص'], ['description', 'شرح'], ['debit', 'بدهکار'], ['credit', 'بستانکار'],
                     ['running_balance', 'مانده']], {link: r => '/entry/' + r.entry_id, totals: ['debit', 'credit']}));
    }
  },
  tb: {
    title: 'تراز آزمایشی', group: 'reports', gate: 'ledger.trial_balance',
    async render(p) {
      const years = await op('years.list');
      const fy = years.find(x => x.code === (p.y || jyear(todayIso))) || years[0];
      if (!fy) return '<p class="muted">سال مالی تعریف نشده است.</p>';
      const from = p.from ? j2iso(p.from) : fy.starts_on, to = p.to ? j2iso(p.to) : (todayIso < fy.ends_on ? todayIso : fy.ends_on), lvl = Number(p.level || 2);
      ctx.after = () => { $('#tgo').onclick = () => location.hash = `#/tb?y=${$('#ty').value}&from=${encodeURIComponent($('#tf').value)}&to=${encodeURIComponent($('#tt').value)}&level=${$('#tl').value}`; };
      const rows = (await op('ledger.trial_balance', {p_year: fy.code, p_from: from, p_to: to})).filter(r => r.party_id === null && r.level <= lvl)
        .sort((a, b) => a.code.localeCompare(b.code));
      return card('', `<div class="row"><label>سال <select id="ty">${options(years, 'code', 'code', fy.code)}</select></label><label>از <input id="tf" value="${jdate(from)}" size="10"></label>
          <label>تا <input id="tt" value="${jdate(to)}" size="10"></label><label>سطح <select id="tl">${[1, 2, 3, 4].map(l => `<option ${l === lvl ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <button class="btn" id="tgo">نمایش</button></div>` +
        table(rows, [['code', 'کد'], ['name', 'حساب'], ['opening', 'مانده اول'], ['period_debit', 'گردش بدهکار'], ['period_credit', 'گردش بستانکار'], ['closing_debit', 'مانده بدهکار'],
                     ['closing_credit', 'مانده بستانکار']], {link: r => `/ledger?code=${r.code}&y=${fy.code}&from=${encodeURIComponent(jdate(from))}&to=${encodeURIComponent(jdate(to))}`,
                     totals: lvl === 1 ? ['period_debit', 'period_credit', 'closing_debit', 'closing_credit'] : undefined}) +
        '<p class="muted">روی هر حساب بزنید تا دفتر آن و از آنجا هر سند و منشأ آن را ببینید.</p>');
    }
  },
  aging: {
    title: 'سن‌بندی مطالبات', group: 'reports', gate: 'ar.aging_report',
    async render() {
      const rows = (await op('ar.aging_report', {p_as_of: todayIso})).slice(0, 300);
      return card('', table(rows, [['party_name', 'شخص'], ['account_code', 'حساب'], ['not_due', 'سررسیدنشده'], ['overdue_1_90', '۱ تا ۹۰ روز'], ['overdue_over_90', 'بیش از ۹۰ روز'],
        ['unapplied_credit', 'بستانکار تخصیص‌نیافته'], ['net', 'خالص'], ['oldest_open_due', 'قدیمی‌ترین سررسید']], {link: r => '/party/' + r.party_id}));
    }
  },
  mgmt: {
    title: 'گزارش مدیریتی', group: 'reports', gate: 'reports.monthly_margin',
    async render(p) {
      const y = p.y || jyear(todayIso);
      const [m, inv] = await Promise.all([op('reports.monthly_margin', {p_year: y}), op('reports.inventory_status', {p_as_of: todayIso})]);
      const tot = k => m.reduce((a, r) => a + Number(r[k]), 0);
      const sum = {period: 'جمع', net_sales: tot('net_sales'), cost_of_sales_kardex: tot('cost_of_sales_kardex'), gross_margin: tot('gross_margin'), gross_sales: tot('gross_sales'),
                   returns_and_discounts: tot('returns_and_discounts'), margin_percent: tot('net_sales') ? (100 * tot('gross_margin') / tot('net_sales')).toFixed(1) : null};
      ctx.after = () => { $('#mgo').onclick = () => location.hash = '#/mgmt?y=' + latin($('#my').value); };
      return card('', `<div class="row"><label>سال مالی <input id="my" value="${esc(y)}" size="5"></label><button class="btn" id="mgo">نمایش</button></div>`) +
        card('فروش و سود ناخالص ماهانه', table(m.length ? [...m, sum] : [], [['period', 'دوره'], ['gross_sales', 'فروش'], ['returns_and_discounts', 'برگشت و تخفیف'], ['net_sales', 'فروش خالص'],
          ['cost_of_sales_kardex', 'بهای فروش (کاردکس)'], ['gross_margin', 'سود ناخالص'], ['margin_percent', 'درصد']]) +
          '<p class="muted">بهای فروش ماهانه از کاردکس برآورد می‌شود (موجودی ادواری، D-02). بهای قطعی سال همان سند بستن سال است.</p>') +
        card('موجودی کالا (بیشترین ارزش)', table(inv.slice(0, 50), [['item_name', 'کالا'], ['warehouse_name', 'انبار'], ['qty', 'مقدار'], ['avg_cost', 'میانگین بها'], ['value', 'ارزش'],
          ['days_since_last_sale', 'روز از آخرین فروش']], {link: r => '/item/' + r.item_id}));
    }
  }
};
