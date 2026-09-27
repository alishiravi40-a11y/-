import {$, $$, card, ctx, dateInput, esc, fmt, j2iso, jdate, jmonthStart, latin, lookup, msg, num, one, op, options, picked, readDate, table, todayIso, can} from '../core.js';
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
        $$('[data-act]').forEach(b => b.onclick = async () => {
          const [id, a] = b.dataset.act.split(':'); const args = {p_cheque: Number(id), p_action: a, p_date: j2iso($('#cdate').value) || todayIso};
          try {
            if (a === 'deposit') args.p_bank_account = Number($('#cbank').value);
            if (a === 'endorse') { const who = prompt('کد پرونده شخصی که چک به او واگذار می‌شود:'); if (!who) return; args.p_party = Number(latin(who)); }
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
        <div class="row">${dateInput('cdate', 'تاریخ عملیات')}<label>بانک برای خواباندن <select id="cbank">${options(banks, 'bank_account_id', 'title')}</select></label></div>` +
        table(rows.map(r => ({...r, st: (STATE[r.state] || r.state) + (r.overdue ? ' ⚠ سررسید گذشته' : ''), dir: r.direction === 'in' ? 'دریافتی' : 'پرداختی', act: acts(r)})),
          [['dir', 'نوع'], ['number', 'شماره'], ['party_name', 'شخص'], ['amount', 'مبلغ'], ['due_date', 'سررسید'], ['st', 'وضعیت'], ['location_name', 'محل'], ['act', '', 'html']]) +
        '<div id="cmsg"></div><p class="muted">هر عملیات سند خودش را دارد؛ «برگرداندن» آخرین عملیات را با سند معکوس خنثی می‌کند، نه با حذف.</p>');
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
      };
      if (!acc) return card('', '<p class="muted">حساب بانکی تعریف نشده است.</p>');
      const [sum, open] = await Promise.all([op('bank.reconciliation', {p_account: acc, p_from: from, p_to: to}), op('bank.open_lines', {p_bank_account: acc, p_from: from, p_to: to})]);
      const s = sum[0] || {};
      return card('', `<div class="row"><label>حساب <select id="bacc">${options(banks, 'bank_account_id', 'title', acc)}</select></label>
          <label>از <input id="bf" value="${jdate(from)}" size="10"></label><label>تا <input id="bt" value="${jdate(to)}" size="10"></label><button class="btn" id="bgo">نمایش</button></div>
        <p>مانده صورت‌حساب ${fmt(s.statement_closing)} · مانده دفتر ${fmt(s.book_closing)} · در بانک و نه در دفتر ${fmt(s.in_bank_not_in_book)} · در دفتر و نه در بانک ${fmt(s.in_book_not_in_bank)} ·
          <b class="${Number(s.unexplained) === 0 ? 'zero' : 'err'}">توضیح‌داده‌نشده ${fmt(s.unexplained)}</b></p>`) +
        card('ردیف‌های تطبیق‌نشده', table(open.map(r => ({...r, pick: r.side === 'bank' ? `<input type="checkbox" data-st="${r.ref}">` : `<input type="checkbox" data-bk="${r.ref}">`,
            sd: r.side === 'bank' ? 'صورت‌حساب بانک' : 'دفتر'})), [['pick', '', 'html'], ['sd', 'طرف'], ['value_date', 'تاریخ'], ['amount', 'مبلغ'], ['description', 'شرح']]) +
          (can('bank.reconcile') ? '<div class="row"><button class="btn primary" id="bmatch">تطبیق ردیف‌های انتخاب‌شده</button></div>' : '') + '<div id="bmsg"></div>');
    }
  }
};
