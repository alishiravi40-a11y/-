import {$, $$, card, ctx, dateInput, esc, fmt, j2iso, jdate, jmonthStart, latin, lookup, msg, num, one, op, options, picked, readDate, table, todayIso, can, upload} from '../core.js';
import {action} from './documents.js';

const STATE = {received: 'نزد صندوق', deposited_for_collection: 'در جریان وصول', collected: 'وصول‌شده', returned_from_bank: 'برگشتی از بانک', returned_to_payer: 'عودت به صاحب',
  endorsed_to_party: 'واگذارشده', cashed: 'نقد شده', issued: 'صادرشده', paid_by_bank: 'پاس‌شده', opening_position: 'انتقالی از سال قبل', moved_between_cashboxes: 'انتقال بین صندوق‌ها',
  returned_by_endorsee: 'برگشت از گیرنده', settled_otherwise: 'تسویه به روش دیگر', closed_before_migration: 'بسته‌شده پیش از انتقال'};
// what can happen next to a cheque, from where it is now
const NEXT = {in: {received: ['deposit', 'return', 'endorse', 'cash'], opening_position: ['deposit', 'return', 'endorse', 'cash'], moved_between_cashboxes: ['deposit', 'return', 'endorse', 'cash'],
                   deposited_for_collection: ['collect', 'bounce'], returned_from_bank: ['deposit', 'return', 'endorse'], returned_by_endorsee: ['deposit', 'return']},
              out: {issued: ['paid'], opening_position: ['paid']}};
const ACT = {deposit: 'خواباندن به بانک', collect: 'وصول', bounce: 'برگشت از بانک', return: 'عودت به صاحب', endorse: 'واگذاری به شخص', cash: 'نقد کردن', paid: 'پاس شد'};

export default {
  cheques: {
    title: 'چک‌ها', group: 'money', gate: 'cheques.list',
    async render(p) {
      const [rows, boxes, banks] = await Promise.all([op('cheques.list', {p_direction: p.dir || null, p_state: p.state || null, p_query: p.q || null, p_limit: 300}),
                                                     op('cashboxes.list'), op('bank_accounts.list')]);
      window._chq = rows;
      ctx.after = () => {
        $('#cgo').onclick = () => location.hash = `#/cheques?dir=${$('#cdir').value}&state=${$('#cstate').value}&q=${encodeURIComponent(latin($('#cq').value))}`;
        if (can('cheques.receive')) {
          lookup('rparty', 'parties.find', 'party_id', 'name'); lookup('iparty', 'parties.find', 'party_id', 'name');
          action('rsave', 'rmsg', async () => {
            if (!picked.rparty) throw new Error('شخص را از فهرست انتخاب کنید.');
            await op('cheques.receive', {p_party: picked.rparty, p_cashbox: Number($('#rbox').value), p_number: latin($('#rno').value), p_bank_code: $('#rbank').value,
                                         p_amount: num('ramount'), p_due: readDate('rdue'), p_date: readDate('rdate'), p_sayad: latin($('#rsayad').value) || null});
            window.dispatchEvent(new Event('almas:refresh'));
          });
          action('isave', 'imsg', async () => {
            if (!picked.iparty) throw new Error('شخص را از فهرست انتخاب کنید.');
            await op('cheques.issue', {p_party: picked.iparty, p_bank_account: Number($('#ibank').value), p_number: latin($('#ino').value), p_amount: num('iamount'),
                                       p_due: readDate('idue'), p_date: readDate('idate'), p_sayad: latin($('#isayad').value) || null});
            window.dispatchEvent(new Event('almas:refresh'));
          });
        }
        lookup('eparty', 'parties.find', 'party_id', 'name');
        $$('[data-act]').forEach(b => b.onclick = async () => {
          const [id, a] = b.dataset.act.split(':'); const args = {p_cheque: Number(id), p_action: a, p_date: j2iso($('#cdate').value) || todayIso};
          try {
            if (a === 'deposit') args.p_bank_account = Number($('#cbank').value);
            if (a === 'endorse') { if (!picked.eparty) throw new Error('نخست در «واگذاری به» شخص را از فهرست انتخاب کنید.'); args.p_party = picked.eparty; }
            if (a === 'undo') { const why = prompt('علت برگرداندن آخرین عملیات این چک:'); if (!why) return;
              await op('cheques.undo_last', {p_cheque: Number(id), p_date: args.p_date, p_reason: why}); }
            else await op('cheques.move', args);
            window.dispatchEvent(new Event('almas:refresh'));
          } catch (e) { msg('cmsg', esc(e.message)); }
        });
      };
      const acts = r => can('cheques.move') ? ((NEXT[r.direction] || {})[r.state] || []).map(a => `<button class="btn" data-act="${r.cheque_id}:${a}">${ACT[a]}</button>`).join(' ') +
        (r.state && !['opening_position', 'closed_before_migration'].includes(r.state) ? ` <button class="btn" data-act="${r.cheque_id}:undo">برگرداندن</button>` : '') : '';
      const forms = can('cheques.receive') ? card('دریافت چک', `<div class="row">${dateInput('rdate')}<label>از شخص <input id="rparty" size="22"></label>
          <label>شماره چک <input id="rno" size="10"></label><label>صیاد <input id="rsayad" size="16"></label><label>بانک <input id="rbank" size="8"></label>
          <label>مبلغ <input id="ramount" inputmode="numeric" size="14"></label>${dateInput('rdue', 'سررسید')}
          <label>به صندوق <select id="rbox">${options(boxes, 'cashbox_id', 'name')}</select></label><button class="btn primary" id="rsave">ثبت دریافت چک</button></div><div id="rmsg"></div>`) +
        card('صدور چک', `<div class="row">${dateInput('idate')}<label>به شخص <input id="iparty" size="22"></label>
          <label>از حساب <select id="ibank">${options(banks, 'bank_account_id', 'title')}</select></label><label>شماره چک <input id="ino" size="10"></label>
          <label>صیاد <input id="isayad" size="16"></label><label>مبلغ <input id="iamount" inputmode="numeric" size="14"></label>${dateInput('idue', 'سررسید')}
          <button class="btn primary" id="isave">ثبت صدور چک</button></div><div id="imsg"></div>`) : '';
      return forms + card('فهرست چک‌ها', `<div class="row"><label>نوع <select id="cdir"><option value="">همه</option><option value="in" ${p.dir === 'in' ? 'selected' : ''}>دریافتی</option>
          <option value="out" ${p.dir === 'out' ? 'selected' : ''}>پرداختی</option></select></label>
          <label>وضعیت <select id="cstate"><option value="">همه</option>${Object.entries(STATE).map(([k, v]) => `<option value="${k}" ${p.state === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label>شماره یا نام <input id="cq" value="${esc(p.q || '')}" size="14"></label><button class="btn" id="cgo">نمایش</button></div>
        <div class="row">${dateInput('cdate', 'تاریخ عملیات')}<label>بانک برای خواباندن <select id="cbank">${options(banks, 'bank_account_id', 'title')}</select></label>
          <label>واگذاری به <input id="eparty" size="20" placeholder="نام شخص"></label></div>` +
        table(rows.map(r => ({...r, st: (STATE[r.state] || r.state) + (r.overdue ? ' ⚠ سررسید گذشته' : ''), dir: r.direction === 'in' ? 'دریافتی' : 'پرداختی', act: acts(r)})),
          [['dir', 'نوع'], ['number', 'شماره'], ['party_name', 'شخص'], ['amount', 'مبلغ'], ['due_date', 'سررسید'], ['st', 'وضعیت'], ['location_name', 'محل'], ['act', '', 'html']]) +
        '<div id="cmsg"></div><p class="muted">هر عملیات سند خودش را دارد؛ «برگرداندن» آخرین عملیات را با سند معکوس خنثی می‌کند، نه با حذف.</p>');
    }
  },
  tdoc: {
    title: 'انتقال وجه، هزینه و کارمزد', group: 'money', gate: 'treasury.post',
    async render(p) {
      const [money, accounts] = await Promise.all([op('money_accounts.list'), op('accounts.tree', {p_as_of: todayIso})]);
      const leaf = accounts.filter(a => a.is_leaf && a.active !== false);
      const K = {transfer: 'انتقال بین صندوق و بانک', expense: 'پرداخت هزینه (بدون فاکتور)', bank_fee: 'کارمزد و هزینه بانکی', other_receipt: 'دریافت متفرقه (سود بانکی و …)'};
      const kind = p.kind in K ? p.kind : 'transfer';
      ctx.after = () => {
        $('#tkind').onchange = () => location.hash = '#/tdoc?kind=' + $('#tkind').value;
        if ($('#tparty')) lookup('tparty', 'parties.find', 'party_id', 'name');
        action('tsave', 'tmsg', async () => {
          const amount = num('tamount'); if (!amount || amount <= 0) throw new Error('مبلغ را وارد کنید.');
          const from = Number($('#tfrom').value); let counter;
          if (kind === 'transfer') {
            const to = Number($('#tto').value); if (to === from) throw new Error('مبدأ و مقصد انتقال باید متفاوت باشند.');
            counter = {account_id: to, amount};
          } else {
            const code = latin($('#tacc').value.trim()), a = leaf.find(x => x.code === code);
            if (!a) throw new Error('کد حساب طرف مقابل را از فهرست انتخاب کنید (حساب معین آخر).');
            if (a.requires_party && !picked.tparty) throw new Error(`حساب «${a.name}» شخص لازم دارد؛ شخص را انتخاب کنید.`);
            counter = {account_id: a.account_id, amount, ...(picked.tparty ? {party_id: picked.tparty} : {})};
          }
          const doc = {kind: {transfer: 'transfer', expense: 'payment', bank_fee: 'bank_fee', other_receipt: 'receipt'}[kind], money_account_id: from, counter: [counter]};
          const e = one(await op('treasury.post', {p_doc: doc, p_date: readDate('tdate'), p_description: $('#tdesc').value || K[kind]}));
          msg('tmsg', `ثبت شد — <a href="#/entry/${e}">نمایش سند</a>`, true); $('#tamount').value = ''; $('#tdesc').value = '';
        });
      };
      const accList = `<datalist id="acclist">${leaf.map(a => `<option value="${esc(a.code)}">${esc(a.name)}</option>`).join('')}</datalist>`;
      const moneyOpt = options(money.map(m => ({...m, label: `${m.name} (${m.kind === 'cash' ? 'صندوق' : 'بانک'})`})), 'account_id', 'label');
      return card('', `<div class="row"><label>نوع <select id="tkind">${Object.entries(K).map(([k, l]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${dateInput('tdate')}</div>
        <div class="row"><label>${kind === 'other_receipt' ? 'به' : 'از'} <select id="tfrom">${moneyOpt}</select></label>
          ${kind === 'transfer' ? `<label>به <select id="tto">${moneyOpt}</select></label>`
            : `<label>${kind === 'other_receipt' ? 'بابت حساب' : 'حساب هزینه'} (کد) <input id="tacc" list="acclist" size="12" placeholder="کد یا از فهرست"></label>${accList}
               <label>شخص (اگر حساب شخص لازم دارد) <input id="tparty" size="20"></label>`}
          <label>مبلغ (ریال) <input id="tamount" inputmode="numeric" size="14"></label><label>شرح <input id="tdesc" size="24"></label>
          <button class="btn primary" id="tsave">ثبت</button></div><div id="tmsg"></div>
        <p class="muted">هر ثبت یک سند حسابداری تراز می‌سازد. اصلاح با «ابطال سند» در صفحه همان سند است، نه حذف. دریافت و پرداخت با اشخاص از «دریافت وجه» و «پرداخت وجه» است و چک از «چک‌ها».</p>`);
    }
  },
  bank: {
    title: 'موجودی بانک و صندوق', group: 'money', gate: 'money.balances',
    async render() {
      const rows = await op('money.balances', {p_as_of: todayIso});
      return card('', table(rows.map(r => ({...r, k: r.kind === 'cash' ? 'صندوق' : 'بانک'})), [['k', 'نوع'], ['code', 'کد حساب'], ['name', 'نام'], ['balance', 'مانده']],
        {link: r => `/ledger?code=${r.code}`, totals: ['balance']}));
    }
  },
  recon: {
    title: 'مغایرت بانکی', group: 'money', gate: 'bank.reconciliation',
    async render(p) {
      const banks = await op('bank_accounts.list');
      const acc = Number(p.acc || (banks[0] || {}).bank_account_id), from = p.from ? j2iso(p.from) : jmonthStart(todayIso), to = p.to ? j2iso(p.to) : todayIso;
      ctx.after = () => {
        $('#bgo').onclick = () => location.hash = `#/recon?acc=${$('#bacc').value}&from=${encodeURIComponent($('#bf').value)}&to=${encodeURIComponent($('#bt').value)}`;
        action('bmatch', 'bmsg', async () => {
          const st = $$('[data-st]:checked').map(i => Number(i.dataset.st)), bk = $$('[data-bk]:checked').map(i => i.dataset.bk.split(':').map(Number));
          if (!st.length || !bk.length) throw new Error('دست‌کم یک ردیف بانک و یک ردیف دفتر انتخاب کنید (جمع دو طرف باید برابر باشد).');
          await op('bank.reconcile', {p_account: acc, p_statement: st, p_book: bk, p_method: 'manual', p_note: null});
          window.dispatchEvent(new Event('almas:refresh'));
        });
        action('bauto', 'bmsg', async () => {
          const r = one(await op('bank.auto_reconcile', {p_account: acc}));
          alert(`تطبیق خودکار: ${r.exact + r.window + r.same_day_sum} گروه (هم‌تاریخ ${r.exact}، با فاصله ${r.window}، جمع یک روز ${r.same_day_sum}). باز مانده: بانک ${r.statement_open}، دفتر ${r.book_open}.`);
          window.dispatchEvent(new Event('almas:refresh'));
        });
        $$('[data-ungroup]').forEach(b => b.onclick = async () => { const why = prompt('علت لغو این تطبیق:'); if (!why) return;
          try { await op('bank.unreconcile', {p_group: Number(b.dataset.ungroup), p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('bmsg', esc(e.message)); } });
        action('sup', 'smsg', async () => {
          const f = $('#sfile').files[0]; if (!f) throw new Error('فایل صورت‌حساب را انتخاب کنید.');
          $('#sprog').hidden = false;
          const r = await upload(`/files/bank_statement?account=${acc}&name=${encodeURIComponent(f.name)}`, f, x => $('#sprog i').style.width = (x * 100) + '%');
          if (r.status === 'duplicate') { msg('smsg', 'این فایل پیش‌تر وارد شده است؛ چیزی تغییر نکرد.', true); return; }
          msg('smsg', `${fmt(r.new_lines)} ردیف تازه و ${fmt(r.known_lines)} ردیف تکراری از ${fmt(r.lines)} ردیف. ${r.balance_chain_ok ? 'زنجیره مانده‌ها درست است.' : '⚠ زنجیره مانده‌ها پیوسته نیست؛ شاید ردیفی جا افتاده یا ترتیب فایل به‌هم خورده است.'}`, true);
          setTimeout(() => window.dispatchEvent(new Event('almas:refresh')), 2500);
        });
      };
      if (!acc) return card('', '<p class="muted">حساب بانکی تعریف نشده است.</p>');
      const [sum, open] = await Promise.all([op('bank.reconciliation', {p_account: acc, p_from: from, p_to: to}), op('bank.open_lines', {p_bank_account: acc, p_from: from, p_to: to})]);
      const s = sum[0] || {};
      const [groups, files] = await Promise.all([op('bank.recon_groups', {p_account: acc, p_from: from, p_to: to}), op('bank.statement_files', {p_account: acc})]);
      const importCard = can('bank.statement_import') ? card('ورود صورت‌حساب بانک', `<div class="row"><label>فایل صورت‌حساب (Excel یا CSV بانک) <input type="file" id="sfile" accept=".xls,.xlsx,.csv,.txt"></label>
          <button class="btn primary" id="sup">ورود به حساب «${esc((banks.find(b => b.bank_account_id === acc) || {}).title || '')}»</button></div>
          <div class="progress noprint" hidden id="sprog"><i></i></div><div id="smsg"></div>
          <p class="muted">ستون‌های «تاریخ»، «واریز» و «برداشت» لازم است؛ «موجودی»، «شرح»، «شماره سند» و «زمان» اگر باشد خوانده می‌شود. همان فایل دوباره چیزی اضافه نمی‌کند و صورت‌حساب‌های هم‌پوشان فقط ردیف‌های تازه را می‌افزایند. ردیف صورت‌حساب پس از ورود حذف یا ویرایش نمی‌شود.</p>` +
          (files.length ? table(files.map(f => ({...f, ok: f.balance_chain_ok === false ? 'ناپیوسته' : 'درست'})), [['imported_at', 'زمان ورود'], ['file_name', 'فایل'], ['new_lines', 'ردیف تازه'],
            ['known_lines', 'تکراری'], ['ok', 'زنجیره مانده'], ['imported_by', 'کاربر']]) : '')) : '';
      const groupCard = groups.length ? card('ردیف‌های تطبیق‌شده این بازه', table(groups.map(g => ({...g, m: {manual: 'دستی', exact: 'خودکار: هم‌تاریخ', window: 'خودکار: چند روز فاصله', same_day_sum: 'خودکار: جمع یک روز'}[g.method] || g.method,
            undo: can('bank.unreconcile') ? `<button class="btn" data-ungroup="${g.group_id}">لغو تطبیق</button>` : ''})),
          [['statement_date', 'تاریخ بانک'], ['amount', 'مبلغ'], ['m', 'روش'], ['created_by', 'کاربر'], ['undo', '', 'html']])) : '';
      return importCard + card('', `<div class="row"><label>حساب <select id="bacc">${options(banks, 'bank_account_id', 'title', acc)}</select></label>
          <label>از <input id="bf" value="${jdate(from)}" size="10"></label><label>تا <input id="bt" value="${jdate(to)}" size="10"></label><button class="btn" id="bgo">نمایش</button></div>
        <p>مانده صورت‌حساب ${fmt(s.statement_closing)} · مانده دفتر ${fmt(s.book_closing)} · در بانک و نه در دفتر ${fmt(s.in_bank_not_in_book)} · در دفتر و نه در بانک ${fmt(s.in_book_not_in_bank)} ·
          <b class="${Number(s.unexplained) === 0 ? 'zero' : 'err'}">توضیح‌داده‌نشده ${fmt(s.unexplained)}</b></p>`) +
        card('ردیف‌های تطبیق‌نشده', table(open.map(r => ({...r, pick: r.side === 'bank' ? `<input type="checkbox" data-st="${r.ref}">` : `<input type="checkbox" data-bk="${r.ref}">`,
            sd: r.side === 'bank' ? 'صورت‌حساب بانک' : 'دفتر'})), [['pick', '', 'html'], ['sd', 'طرف'], ['value_date', 'تاریخ'], ['amount', 'مبلغ'], ['description', 'شرح']]) +
          (can('bank.reconcile') ? '<div class="row"><button class="btn primary" id="bmatch">تطبیق ردیف‌های انتخاب‌شده</button><button class="btn" id="bauto">تطبیق خودکار موارد بی‌ابهام</button></div>' : '') + '<div id="bmsg"></div>') +
        groupCard;
    }
  }
};
