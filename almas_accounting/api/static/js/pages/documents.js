import {$, $$, card, ctx, dateInput, esc, fmt, latin, lookup, msg, num, one, op, options, picked, readDate, table, can} from '../core.js';

// a button that cannot be pressed twice while its request runs (no double posting)
export function action(id, msgId, fn) {
  const b = $('#' + id); if (!b) return;
  b.onclick = async () => { if (b.disabled) return; b.disabled = true;
    try { await fn(); } catch (e) { msg(msgId, esc(e.message)); } finally { b.disabled = false; } };
}
export async function voucherHtml(source, ref) {
  const rows = await op('documents.voucher', {p_source: source, p_ref: String(ref)});
  return `<h2>سند حسابداری ${rows.length ? `<a href="#/entry/${rows[0].entry_id}">${fmt(rows[0].number)}</a>` : ''}</h2>` +
    table(rows, [['account_code', 'کد'], ['account_name', 'حساب'], ['party_name', 'شخص'], ['debit', 'بدهکار'], ['credit', 'بستانکار']], {totals: ['debit', 'credit']});
}

async function invoiceForm(kind) {
  const [wh, cash] = await Promise.all([op('warehouses.list'), op('money_accounts.list')]);
  const sale = kind === 'sales', lines = [];
  ctx.after = () => {
    lookup('iparty', 'parties.find', 'party_id', 'name'); lookup('iitem', 'items.find', 'item_id', 'name');
    const draw = () => { const t = lines.reduce((a, l) => a + l.quantity * l.unit_price - l.discount, 0);
      $('#ilines').innerHTML = lines.length ? table(lines.map((l, i) => ({...l, n: i + 1, total: l.quantity * l.unit_price - l.discount,
          del: `<button class="btn" data-del="${i}">حذف</button>`})),
        [['n', 'ردیف'], ['name', 'کالا'], ['wh', 'انبار'], ['quantity', 'تعداد'], ['unit_price', 'قیمت واحد'], ['discount', 'تخفیف'], ['total', 'جمع'], ['del', '', 'html']]) +
        `<p class="big">جمع فاکتور: ${fmt(t)} ریال</p>` : '';
      $$('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }); };
    action('iadd', 'imsg', async () => {
      if (!picked.iitem) throw new Error('کالا را از فهرست انتخاب کنید.');
      const q = num('iqty'), pr = num('iprice');
      if (!q || q <= 0 || pr === null || pr < 0) throw new Error('تعداد و قیمت را درست وارد کنید.');
      lines.push({item_id: picked.iitem, name: $('#iitem').value, warehouse_id: Number($('#iwh').value), wh: $('#iwh').selectedOptions[0].text,
                  quantity: q, unit_price: pr, discount: num('idisc') || 0});
      $('#iitem').value = ''; $('#iprice').value = ''; $('#iqty').value = 1; $('#idisc').value = 0; $('#imsg').innerHTML = ''; draw(); $('#iitem').focus();
    });
    action('isave', 'imsg', async () => {
      if (!picked.iparty || !lines.length) throw new Error((sale ? 'مشتری' : 'تأمین‌کننده') + ' و دست‌کم یک ردیف لازم است.');
      const date = readDate('idate'), paid = num('ipaid') || 0;
      const acc = cash.find(m => m.account_id === Number($('#icash').value));      // the method follows the chosen box or bank account
      const pay = paid > 0 ? [{method: acc && acc.kind === 'bank' ? 'bank' : 'cash', account_id: acc.account_id, amount: paid}] : [];
      const body = lines.map(({item_id, warehouse_id, quantity, unit_price, discount}) => ({item_id, warehouse_id, quantity, unit_price, discount}));
      let id;
      if (sale) {
        id = one(await op('sales.create', {p_date: date, p_party: picked.iparty, p_lines: body, p_payments: pay}));
        try { await op('sales.finalize', {p_invoice: id}); }
        catch (e) {
          if (!/below/.test(e.raw || e.message)) throw e;
          const reason = prompt('فروش زیر قیمت خرید است. در صورت تأیید، علت را بنویسید:');
          if (!reason) throw new Error('فاکتور به‌صورت پیش‌نویس ماند (فروش زیر قیمت خرید تأیید نشد).');
          await op('sales.finalize', {p_invoice: id, p_acknowledge_below_cost: true, p_below_cost_reason: reason});
        }
      } else {
        id = one(await op('purchase.create', {p_date: date, p_party: picked.iparty, p_lines: body, p_payments: pay,
                                              p_supplier_invoice_no: $('#isupno').value || null, p_extra_cost: num('iextra') || 0}));
        await op('purchase.finalize', {p_invoice: id});
      }
      $('#imsg').innerHTML = `<p class="zero">فاکتور ثبت نهایی شد (سند حسابداری و ${sale ? 'خروج' : 'ورود'} کالا). <a class="btn primary" href="#/invoice/${id}?kind=${kind}">نمایش و چاپ فاکتور</a></p>` +
                             await voucherHtml(sale ? 'sales_invoice' : 'purchase_invoice', id);
      lines.length = 0; draw();
    });
  };
  return card('', `<div class="row">${dateInput('idate')}
      <label>${sale ? 'مشتری' : 'تأمین‌کننده'} <input id="iparty" placeholder="نام، کد ملی یا موبایل" size="28"></label>
      ${sale ? '' : '<label>شماره فاکتور فروشنده <input id="isupno" size="12"></label><label>هزینه‌های فاکتور (حمل و …) <input id="iextra" inputmode="numeric" value="0" size="12"></label>'}
      <a class="btn" href="#/party/new">+ شخص تازه</a></div>
    <div class="row"><label>کالا <input id="iitem" size="24"></label>
      <label>انبار <select id="iwh">${options(wh, 'warehouse_id', 'name')}</select></label>
      <label>تعداد <input id="iqty" inputmode="decimal" value="1" size="6"></label>
      <label>قیمت واحد (ریال) <input id="iprice" inputmode="numeric" size="14"></label>
      <label>تخفیف ردیف <input id="idisc" inputmode="numeric" value="0" size="10"></label>
      <button class="btn" id="iadd">افزودن ردیف</button></div>
    <div id="ilines"></div>
    <div class="row"><label>${sale ? 'دریافت همان لحظه' : 'پرداخت همان لحظه'} (ریال) <input id="ipaid" inputmode="numeric" value="0" size="14"></label>
      <label>${sale ? 'به' : 'از'} <select id="icash">${options(cash.map(m => ({...m, label: `${m.name} (${m.kind === 'cash' ? 'صندوق' : 'بانک'})`})), 'account_id', 'label')}</select></label>
      <button class="btn primary" id="isave">ثبت نهایی فاکتور</button></div>
    <div id="imsg"></div>`);
}

async function moneyForm(kind) {
  const cash = await op('money_accounts.list');
  ctx.after = () => {
    lookup('mparty', 'parties.find', 'party_id', 'name');
    action('msave', 'mmsg', async () => {
      if (!picked.mparty) throw new Error('شخص را از فهرست انتخاب کنید.');
      const amount = num('mamount'); if (!amount || amount <= 0) throw new Error('مبلغ را وارد کنید.');
      const entry = one(await op(kind === 'receive' ? 'treasury.receive' : 'treasury.pay', {p_party: picked.mparty, p_money_account: Number($('#mcash').value),
                                 p_amount: amount, p_date: readDate('mdate'), p_description: $('#mdesc').value || null}));
      $('#mmsg').innerHTML = `<p class="zero">${kind === 'receive' ? 'دریافت' : 'پرداخت'} ثبت شد — <a href="#/entry/${entry}">نمایش سند</a> · <a href="#/settle?party=${picked.mparty}">تطبیق حساب این شخص با فاکتورها</a></p>`;
      $('#mamount').value = ''; $('#mdesc').value = '';
    });
  };
  return card('', `<div class="row">${dateInput('mdate')}
      <label>${kind === 'receive' ? 'از' : 'به'} شخص <input id="mparty" size="28"></label>
      <label>مبلغ (ریال) <input id="mamount" inputmode="numeric" size="16"></label>
      <label>${kind === 'receive' ? 'به' : 'از'} <select id="mcash">${options(cash, 'account_id', 'name')}</select></label>
      <label>شرح <input id="mdesc" size="24"></label>
      <button class="btn primary" id="msave">ثبت</button></div><div id="mmsg"></div>
      <p class="muted">پرداخت یا دریافت با چک از صفحه «چک‌ها» ثبت می‌شود.</p>`);
}

export default {
  sales: {title: 'فاکتور فروش', group: 'daily', gate: 'sales.create', render: () => invoiceForm('sales')},
  purchase: {title: 'فاکتور خرید', group: 'daily', gate: 'purchase.create', render: () => invoiceForm('purchase')},
  ret: {
    title: 'برگشت فروش / خرید', group: 'daily', gate: 'return.create',
    async render(p) {
      ctx.after = () => {
        if (p.kind) $('#rkind').value = p.kind;
        if (p.q) { $('#rinv').value = p.q; setTimeout(() => $('#rfind').click(), 0); }
        action('rfind', 'rmsg', async () => {
          const kind = $('#rkind').value;
          const rows = await op('invoices.find', {p_kind: kind, p_query: latin($('#rinv').value.trim())});
          $('#rlist').innerHTML = table(rows.map(r => ({...r, pick: `<button class="btn" data-pick="${r.invoice_id}">انتخاب</button>`})),
            [['number', 'شماره'], ['invoice_date', 'تاریخ'], ['party_name', 'شخص'], ['total', 'مبلغ'], ['pick', '', 'html']]);
          $$('[data-pick]').forEach(b => b.onclick = () => pick(kind, Number(b.dataset.pick)));
        });
      };
      const pick = async (kind, invoice) => {
        const rows = await op('invoices.returnable', {p_kind: kind, p_invoice: invoice});
        $('#rlines').innerHTML = '<h2>ردیف‌های قابل برگشت</h2>' + table(rows.map(r => ({...r,
            q: `<input inputmode="decimal" value="0" data-line="${r.line_no}" data-max="${r.returnable}" size="6">`})),
          [['line_no', 'ردیف'], ['item_name', 'کالا'], ['quantity', 'تعداد فاکتور'], ['returnable', 'قابل برگشت'], ['net_unit_price', 'قیمت واحد'], ['q', 'تعداد برگشتی', 'html']]) +
          `<div class="row">${dateInput('rdate')}<label>علت <input id="rreason" size="30"></label><button class="btn primary" id="rsave">ثبت نهایی برگشت</button></div>`;
        action('rsave', 'rmsg', async () => {
          const lines = $$('#rlines input[data-line]').map(i => ({original_line_no: Number(i.dataset.line), quantity: Number(latin(i.value))})).filter(l => l.quantity > 0);
          if (!lines.length) throw new Error('دست‌کم یک ردیف با تعداد برگشتی لازم است.');
          const id = one(await op('return.create', {p_kind: kind === 'sales' ? 'sales_return' : 'purchase_return', p_invoice: invoice,
                                                    p_date: readDate('rdate'), p_reason: $('#rreason').value, p_lines: lines}));
          await op('return.finalize', {p_return: id});
          $('#rmsg').innerHTML = `<p class="zero">برگشت ثبت نهایی شد. <a class="btn primary" href="#/invoice/${id}?kind=return">نمایش و چاپ برگشت</a></p>` + await voucherHtml('return', id);
          pick(kind, invoice);
        });
      };
      return card('', `<div class="row"><label>نوع <select id="rkind"><option value="sales">برگشت از فروش</option><option value="purchase">برگشت از خرید</option></select></label>
        <label>فاکتور (شماره یا نام شخص) <input id="rinv" size="24"></label><button class="btn" id="rfind">جست‌وجو</button></div>
        <div id="rlist"></div><div id="rlines"></div><div id="rmsg"></div>
        <p class="muted">فاکتور قطعی حذف یا ویرایش نمی‌شود؛ اصلاح آن فقط با برگشت است.</p>`);
    }
  },
  receipt: {title: 'دریافت وجه', group: 'daily', gate: 'treasury.receive', render: () => moneyForm('receive')},
  payment: {title: 'پرداخت وجه', group: 'daily', gate: 'treasury.pay', render: () => moneyForm('pay')},
  settle: {
    title: 'تطبیق حساب شخص', group: 'books', gate: 'ar.allocate',
    async render(p) {
      ctx.after = () => {
        lookup('tparty', 'parties.find', 'party_id', 'name');
        const show = async pid => {
          const rows = await op('ar.party_subledgers', {p_party: pid});
          $('#tsub').innerHTML = table(rows.map(r => ({...r, act: (Number(r.open_debit) > 0 && Number(r.open_credit) > 0)
              ? `<button class="btn" data-fifo="${r.account_id}">تطبیق خودکار</button>` : '—'})),
            [['account_code', 'حساب'], ['account_name', 'نام حساب'], ['balance', 'مانده'], ['open_debit', 'بدهی باز'], ['open_credit', 'بستانکار باز'], ['act', '', 'html']]);
          const sets = await op('ar.settlements', {p_party: pid});
          const M = {legacy_fifo: 'خودکار (انتقال از هلو)', fifo: 'خودکار', manual: 'دستی'};
          $('#tsets').innerHTML = sets.length ? '<h3>تخصیص‌های فعلی</h3>' + table(sets.map(x => ({...x, m: M[x.method] || x.method,
              undo: can('ar.unallocate') ? `<button class="btn" data-unset="${x.settlement_id}">برگرداندن</button>` : ''})),
            [['debit_date', 'تاریخ بدهی'], ['debit_voucher', 'سند بدهی'], ['credit_date', 'تاریخ پرداخت'], ['credit_voucher', 'سند پرداخت'], ['amount', 'مبلغ'], ['m', 'روش'], ['undo', '', 'html']]) : '';
          $$('[data-unset]').forEach(b => b.onclick = async () => { const why = prompt('علت برگرداندن این تخصیص:'); if (!why) return;
            try { await op('ar.unallocate', {p_id: Number(b.dataset.unset), p_reason: why}); msg('tmsg', 'تخصیص برگشت خورد.', true); show(pid); } catch (e) { msg('tmsg', esc(e.message)); } });
          $$('[data-fifo]').forEach(b => b.onclick = async () => { try {
            const n = one(await op('ar.allocate_fifo', {p_account: Number(b.dataset.fifo), p_party: pid}));
            msg('tmsg', `${fmt(n)} تخصیص ثبت شد.`, true); show(pid); } catch (e) { msg('tmsg', esc(e.message)); } });
        };
        action('tshow', 'tmsg', async () => { if (!picked.tparty) throw new Error('شخص را از فهرست انتخاب کنید.'); await show(picked.tparty); });
        if (p.party) show(Number(p.party));
      };
      return card('', `<div class="row"><label>شخص <input id="tparty" size="28"></label><button class="btn" id="tshow">نمایش</button></div><div id="tsub"></div><div id="tmsg"></div><div id="tsets"></div>
        <p class="muted">تطبیق، دریافت‌ها و بستانکاری‌های باز را به ترتیب قدیمی‌ترین بدهی تخصیص می‌دهد. هر تخصیص با علت قابل برگشت است.</p>`);
    }
  }
};
