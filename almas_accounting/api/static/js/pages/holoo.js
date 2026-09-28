// Holoo coexistence: every backup import (backup → reader → staging → change detection → import → reconciliation) and its review items
import {$$, card, ctx, esc, fmt, jdate, msg, one, op, table, can} from '../core.js';

const STATUS = {running: 'در حال اجرا', reconciled: 'تطبیق کامل', differences: 'مغایرت دارد', failed: 'ناموفق', refused: 'ردشده'};
const CHANGE = {added: 'تازه', changed: 'تغییرکرده', removed_in_source: 'حذف‌شده در هلو'};
const CHECK = {ledger_balances: 'مانده حساب‌ها (هر حساب و شخص)', vouchers: 'تعداد اسناد و نبود ثبت تکراری', inventory: 'موجودی هر کد کالا',
               cheques: 'چک‌ها', tax_submissions: 'سوابق مؤدیان', parties: 'اشخاص', receivables_aging: 'سنی بدهکاران = مانده حساب',
               holoo_view_MandehOfSarfasl: 'مانده‌ها با گزارش خود هلو'};
const REVIEW = {open: 'باز', accepted: 'پذیرفته‌شده', corrected: 'اصلاح‌شده'};
const badge = s => `<span class="${s === 'reconciled' || s === 'pass' ? 'zero' : 'err'}">${esc(STATUS[s] || (s === 'pass' ? 'برابر' : s === 'fail' ? 'نابرابر' : s))}</span>`;
const detail = o => Object.entries(o || {}).filter(([k]) => k !== 'status').map(([k, v]) => `${esc(k)}: ${fmt(typeof v === 'object' ? JSON.stringify(v) : v)}`).join('، ');

export default {
  imports: {
    title: 'ورود Backup هلو', group: 'holoo', gate: 'imports.list',
    async render() {
      const rows = await op('imports.list', {p_limit: 100});
      return card('', table(rows.map(r => ({...r, st: badge(r.status), when: jdate(r.started_at)})),
          [['batch_id', 'شماره'], ['when', 'تاریخ'], ['source_db', 'پایگاه هلو'], ['fiscal_year', 'سال'], ['st', 'نتیجه', 'html'], ['changes', 'تغییرات'],
           ['open_reviews', 'موارد باز بررسی'], ['triggered_by', 'اجراکننده']], {link: r => '/import/' + r.batch_id}) +
        `<p class="muted">هر Backup تازه هلو با دستور <code>python -m migration.import_backup</code> خوانده می‌شود: بررسی سلامت، ثبت تغییرات نسبت به Backup قبلی،
         انتقال (سند تغییرکرده برگشت و دوباره ثبت می‌شود؛ هیچ سابقه‌ای ویرایش یا حذف نمی‌شود) و تطبیق کامل با هلو. Backup قدیمی‌تر از آخرین ورود پذیرفته نمی‌شود.</p>`);
    }
  },
  import: {
    title: 'جزئیات ورود Backup', group: 'holoo', menu: false, gate: 'imports.detail',
    async render(p) {
      const d = one(await op('imports.detail', {p_batch: Number(p.id)}));
      if (!d) return card('', '<p class="err">پیدا نشد.</p>');
      ctx.after = () => $$('[data-rv]').forEach(b => b.onclick = async () => {
        const [id, st] = b.dataset.rv.split(':'); const why = prompt(st === 'accepted' ? 'چرا تغییر هلو پذیرفته می‌شود؟' : 'چه اصلاحی انجام شد؟'); if (!why) return;
        try { await op('imports.review_resolve', {p_review: Number(id), p_status: st, p_resolution: why}); window.dispatchEvent(new Event('almas:refresh')); }
        catch (e) { msg('rvmsg', esc(e.message)); } });
      const tables = Object.entries((d.change_summary || {}).tables || {}).filter(([, v]) => v.added || v.changed || v.removed_in_source)
        .map(([t, v]) => ({t, ...v}));
      const recon = Object.entries(d.reconciliation || {}).map(([k, v]) => ({k: CHECK[k] || k, st: badge(v.status), d: detail(v)}));
      const steps = Object.entries(d.migration || {}).filter(([k]) => !k.endsWith('_seconds')).map(([k, v]) => ({k, d: detail(v), s: (d.migration || {})[k + '_seconds']}));
      const rv = (d.reviews || []).map(r => ({...r, key: JSON.stringify(r.entity_key), ch: CHANGE[r.change] || r.change, st: REVIEW[r.status],
        act: r.status === 'open' && can('imports.review_resolve') ? `<button class="btn" data-rv="${r.id}:accepted">پذیرش</button> <button class="btn" data-rv="${r.id}:corrected">اصلاح شد</button>` : esc(r.resolution || '')}));
      return card(`ورود شماره ${fmt(d.id)} — ${badge(d.status)}`,
          `<p>پایگاه هلو: <b>${esc(d.source_db || '—')}</b>، سال ${esc(d.fiscal_year || '—')}، Backup ${esc((d.backup_sha256 || '').slice(0, 12))}، پایان Backup ${esc(d.backup_finished_at || '—')}،
           نتیجه خواندن: ${esc(d.reader_status || '—')}، سلامت: ${d.reader_checks ? (d.reader_checks.gate_passed ? 'قبول' : 'رد') : '—'}</p>` +
          (d.error ? `<p class="err">${esc(d.error)}</p>` : '')) +
        card('تغییرات نسبت به Backup قبلی', tables.length ? table(tables, [['t', 'جدول'], ['added', 'تازه'], ['changed', 'تغییرکرده'], ['removed_in_source', 'حذف‌شده'], ['unchanged', 'بدون تغییر']])
             : '<p class="muted">تغییری نبود (یا نخستین ورود این پایگاه است).</p>') +
        card('تطبیق با هلو', table(recon, [['k', 'کنترل'], ['st', 'نتیجه', 'html'], ['d', 'جزئیات']])) +
        card('مراحل انتقال', table(steps, [['k', 'مرحله'], ['d', 'نتیجه'], ['s', 'ثانیه']])) +
        card('تغییرات نیازمند بررسی انسانی (چک و مؤدیان)', table(rv, [['entity', 'نوع'], ['key', 'کلید هلو'], ['ch', 'تغییر'], ['detail', 'شرح'], ['st', 'وضعیت'], ['act', '', 'html']]) + '<div id="rvmsg"></div>');
    }
  }
};
