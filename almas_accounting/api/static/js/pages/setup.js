// Setup without SQL: the company profile (printed on documents), warehouses, cash boxes and the company's bank accounts
import {$, $$, card, ctx, esc, msg, one, op, table, can, printHead} from '../core.js';
import {action} from './documents.js';

const refresh = () => window.dispatchEvent(new Event('almas:refresh'));
const back = () => location.hash === '#/setup' ? refresh() : (location.hash = '#/setup');   // same address: re-draw
const COMPANY = [['company_title', 'نام شرکت یا فروشگاه'], ['company_national_id', 'شناسه ملی'], ['company_economic_code', 'کد اقتصادی'],
                 ['company_phone', 'تلفن'], ['company_address', 'نشانی']];

export default {
  setup: {
    title: 'پایه‌ها: شرکت، انبار، صندوق، بانک', group: 'admin', gate: 'setup.overview',
    async render(p) {
      const [d, settings] = await Promise.all([op('setup.overview').then(one), op('settings.list')]);
      const val = k => (settings.find(s => s.key === k) || {}).value || '';
      const w = p.w ? d.warehouses.find(x => String(x.warehouse_id) === p.w) || {} : null;
      const c = p.c ? d.cashboxes.find(x => String(x.cashbox_id) === p.c) || {} : null;
      const b = p.b ? d.bank_accounts.find(x => String(x.bank_account_id) === p.b) || {} : null;
      const editing = w || c || b;
      ctx.after = () => {
        action('cosave', 'comsg', async () => {
          const why = 'به‌روزرسانی مشخصات شرکت برای چاپ';
          for (const [k] of COMPANY) if ($('#' + k).value.trim() !== val(k)) await op('settings.change', {p_key: k, p_value: $('#' + k).value.trim(), p_reason: why});
          await printHead(); msg('comsg', 'ذخیره شد؛ سربرگ چاپ به‌روز شد.', true);
        });
        action('wsave', 'wmsg', async () => {
          await op('setup.warehouse_save', {p_warehouse: w && w.warehouse_id || null, p_code: $('#wcode').value || null, p_name: $('#wname').value,
                                            p_active: $('#wactive') ? $('#wactive').checked : true});
          back();
        });
        action('csave', 'cmsg', async () => {
          await op('setup.cashbox_save', {p_cashbox: c && c.cashbox_id || null, p_name: $('#cname').value, p_cash_account_code: $('#ccash').value.trim(),
                                          p_cheque_account_code: $('#ccheque').value.trim() || null});
          back();
        });
        action('bsave', 'bmsg', async () => {
          await op('setup.bank_account_save', {p_bank_account: b && b.bank_account_id || null, p_bank_code: $('#bbank').value, p_account_no: $('#bno').value,
            p_title: $('#btitle').value, p_gl_account_code: $('#bgl').value.trim(), p_collection_account_code: $('#bcol').value.trim() || null,
            p_payable_cheque_account_code: $('#bpay').value.trim() || null, p_fee_account_code: $('#bfee').value.trim() || null, p_is_pos: $('#bpos').checked});
          back();
        });
      };
      const may = can('setup.warehouse_save'), f = (id, label, v, size = 14, extra = '') => `<label>${label} <input id="${id}" value="${esc(v ?? '')}" size="${size}" ${extra}></label>`;
      const company = card('مشخصات شرکت (سربرگ فاکتور و گزارش‌های چاپی)', `<div class="row">${COMPANY.map(([k, l]) => f(k, l, val(k), k === 'company_address' ? 40 : 18)).join('')}</div>
          ${can('settings.change') ? '<div class="row"><button class="btn primary" id="cosave">ذخیره</button></div>' : '<p class="muted">تغییر مشخصات با مجوز «تنظیمات» است.</p>'}<div id="comsg"></div>`);
      const whs = card('انبارها', table(d.warehouses.map(x => ({...x, st: x.active ? 'فعال' : 'غیرفعال'})), [['code', 'کد'], ['name', 'نام'], ['items_in_stock', 'کالای دارای موجودی'], ['st', 'وضعیت']],
          {link: x => '/setup?w=' + x.warehouse_id}) + (may && (!editing || w) ? `<h3>${w && w.warehouse_id ? 'ویرایش انبار' : 'انبار تازه'}</h3><div class="row">
          ${f('wname', 'نام', w && w.name, 20)}${w && w.warehouse_id ? `<label><input type="checkbox" id="wactive" ${w.active ? 'checked' : ''}> فعال</label>` : f('wcode', 'کد (اختیاری)', '', 6)}
          <button class="btn primary" id="wsave">ذخیره</button>${w ? '<a class="btn" href="#/setup">انصراف</a>' : ''}</div><div id="wmsg"></div>` : ''));
      const boxes = card('صندوق‌ها', table(d.cashboxes, [['code', 'کد'], ['name', 'نام'], ['cash_account', 'حساب نقد'], ['cheque_account', 'حساب چک‌های دریافتنی']],
          {link: x => '/setup?c=' + x.cashbox_id}) + (may && (!editing || c) ? `<h3>${c && c.cashbox_id ? 'ویرایش صندوق' : 'صندوق تازه'}</h3><div class="row">
          ${f('cname', 'نام', c && c.name, 18)}${f('ccash', 'کد حساب نقد', c && c.cash_account, 10)}${f('ccheque', 'کد حساب چک‌ها (اختیاری)', c && c.cheque_account, 10)}
          <button class="btn primary" id="csave">ذخیره</button>${c ? '<a class="btn" href="#/setup">انصراف</a>' : ''}</div><div id="cmsg"></div>` : ''));
      const banks = card('حساب‌های بانکی شرکت', table(d.bank_accounts.map(x => ({...x, pos: x.is_pos ? 'بله' : ''})), [['title', 'عنوان'], ['bank_code', 'بانک'], ['account_no', 'شماره حساب'],
          ['gl_account', 'حساب در دفتر'], ['collection_account', 'در جریان وصول'], ['payable_cheque_account', 'اسناد پرداختنی'], ['fee_account', 'کارمزد'], ['pos', 'کارت‌خوان'], ['statement_lines', 'ردیف صورت‌حساب']],
          {link: x => '/setup?b=' + x.bank_account_id}) + (may && (!editing || b) ? `<h3>${b && b.bank_account_id ? 'ویرایش حساب بانکی' : 'حساب بانکی تازه'}</h3><div class="row">
          ${f('btitle', 'عنوان', b && b.title, 18)}${f('bbank', 'بانک', b && b.bank_code, 10)}${f('bno', 'شماره حساب', b && b.account_no, 16)}
          ${f('bgl', 'کد حساب بانک در دفتر', b && b.gl_account, 10)}${f('bcol', 'کد حساب چک در جریان وصول', b && b.collection_account, 10)}
          ${f('bpay', 'کد حساب اسناد پرداختنی', b && b.payable_cheque_account, 10)}${f('bfee', 'کد حساب کارمزد', b && b.fee_account, 10)}
          <label><input type="checkbox" id="bpos" ${b && b.is_pos ? 'checked' : ''}> کارت‌خوان</label>
          <button class="btn primary" id="bsave">ذخیره</button>${b ? '<a class="btn" href="#/setup">انصراف</a>' : ''}</div><div id="bmsg"></div>` : ''));
      return company + whs + boxes + banks +
        '<p class="muted">حساب هر صندوق و بانک باید یک حساب معین آخرِ ترازنامه‌ای و بدون شخص باشد و به صندوق یا بانک دیگری وصل نباشد. حسابی را که گردش دارد نمی‌توان عوض کرد؛ برای حساب تازه، صندوق یا بانک تازه تعریف کنید. حساب تازه را نخست در «سرفصل حساب‌ها» بسازید.</p>';
    }
  }
};
