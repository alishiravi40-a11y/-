import {$, $$, api, card, ctx, esc, fmt, latin, msg, op, options, session, table, can} from '../core.js';
import {action} from './documents.js';

const KIND = {person: 'شخص', service: 'سرویس', ai_agent: 'عامل هوش مصنوعی'};
const PSTATUS = {open: 'باز', closing: 'در حال بستن', closed: 'بسته'};

export default {
  users: {
    title: 'کاربران و مجوزها', group: 'admin', gate: 'users.list',
    async render(p) {
      const [users, perms] = await Promise.all([op('users.list'), op('permissions.list')]);
      const u = p.u ? users.find(x => x.username === p.u) : null;
      ctx.after = () => {
        action('ucreate', 'umsg', async () => { await op('users.create', {p_username: $('#uname').value.trim(), p_display_name: $('#udisp').value, p_kind: $('#ukind').value});
          location.hash = '#/users?u=' + $('#uname').value.trim(); });
        if (!u) return;
        $$('[data-grant]').forEach(b => b.onclick = async () => { const why = prompt('علت اعطای مجوز:'); if (!why) return;
          try { await op('permissions.grant', {p_target: u.username, p_permission: b.dataset.grant, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); }
          catch (e) { msg('umsg2', esc(e.message)); } });
        $$('[data-revoke]').forEach(b => b.onclick = async () => { const why = prompt('علت لغو مجوز:'); if (!why) return;
          try { await op('permissions.revoke', {p_target: u.username, p_permission: b.dataset.revoke, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); }
          catch (e) { msg('umsg2', esc(e.message)); } });
        action('upw', 'umsg2', async () => { await api('/auth/admin/password', {username: u.username, new_password: $('#upass').value});
          msg('umsg2', 'رمز موقت تعیین شد؛ کاربر در ورود بعد باید آن را عوض کند.', true); });
        action('uact', 'umsg2', async () => { const why = prompt('علت:'); if (!why) return;
          await op('users.set_active', {p_username: u.username, p_active: !u.active, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); });
        action('umfa', 'umsg2', async () => { const why = prompt('علت بازنشانی ورود دومرحله‌ای:'); if (!why) return;
          await api('/auth/admin/mfa_reset', {username: u.username, reason: why}); msg('umsg2', 'بازنشانی شد.', true); });
      };
      let out = card('', table(users.map(x => ({...x, k: KIND[x.kind], perms: x.permissions.length, mfa: x.mfa_enabled ? 'بله' : 'خیر', act: x.active ? 'فعال' : 'غیرفعال'})),
          [['username', 'نام کاربری'], ['display_name', 'نام'], ['k', 'نوع'], ['agent_code', 'نماینده'], ['perms', 'تعداد مجوز'], ['mfa', 'دومرحله‌ای'], ['act', 'وضعیت'], ['last_login', 'آخرین ورود']],
          {link: x => '/users?u=' + x.username}) +
        `<div class="row"><label>نام کاربری تازه <input id="uname" size="12"></label><label>نام <input id="udisp" size="16"></label>
          <label>نوع <select id="ukind"><option value="person">شخص</option><option value="service">سرویس</option><option value="ai_agent">عامل هوش مصنوعی</option></select></label>
          <button class="btn" id="ucreate">ساخت کاربر</button></div><div id="umsg"></div>`);
      if (u) out += card(`مجوزهای ${esc(u.username)}`, table(perms.map(x => ({...x, has: u.permissions.includes(x.code),
            po: x.people_only ? 'فقط انسان' : '', act: u.permissions.includes(x.code) ? `<button class="btn" data-revoke="${x.code}">لغو</button>` : `<button class="btn" data-grant="${x.code}">اعطا</button>`})),
          [['code', 'مجوز'], ['description', 'شرح'], ['po', ''], ['has', 'دارد'], ['act', '', 'html']]) +
        `<div class="row"><label>رمز موقت <input id="upass" type="password" size="16" autocomplete="new-password"></label><button class="btn" id="upw">تعیین رمز موقت</button>
          <button class="btn" id="uact">${u.active ? 'غیرفعال کردن' : 'فعال کردن'}</button><button class="btn" id="umfa">بازنشانی ورود دومرحله‌ای</button></div><div id="umsg2"></div>`);
      return out;
    }
  },
  periods: {
    title: 'سال‌ها و دوره‌ها', group: 'admin', gate: 'periods.list',
    async render() {
      const rows = await op('periods.list');
      ctx.after = () => $$('[data-per]').forEach(b => b.onclick = async () => { const [id, st] = b.dataset.per.split(':'); const why = prompt('علت تغییر وضعیت دوره:'); if (!why) return;
        try { await op('periods.change_status', {p_period: Number(id), p_new: st, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('permsg', esc(e.message)); } });
      const nxt = s => s === 'open' ? [['closing', 'شروع بستن']] : s === 'closing' ? [['closed', 'بستن'], ['open', 'بازگشایی']] : [['open', 'بازگشایی']];
      return card('', table(rows.map(r => ({...r, st: PSTATUS[r.status] || r.status, act: nxt(r.status).map(([s, l]) => `<button class="btn" data-per="${r.period_id}:${s}">${l}</button>`).join(' ')})),
          [['fiscal_year', 'سال'], ['period', 'دوره'], ['starts_on', 'از'], ['ends_on', 'تا'], ['st', 'وضعیت'], ['entries', 'تعداد سند'], ['act', '', 'html']]) +
        '<p class="muted">دوره بسته هیچ سندی نمی‌پذیرد؛ دوره در حال بستن فقط سند اصلاحی. بستن و بازگشایی فقط با مجوز، علت و Audit (D-05).</p><div id="permsg"></div>');
    }
  },
  settings: {
    title: 'تنظیمات', group: 'admin', gate: 'settings.list',
    async render() {
      const rows = await op('settings.list');
      ctx.after = () => $$('[data-set]').forEach(b => b.onclick = async () => { const k = b.dataset.set, r = rows.find(x => x.key === k);
        const v = prompt(`مقدار تازه ${k}${r.allowed ? ' (یکی از: ' + r.allowed.join('، ') + ')' : ''}:`, r.value); if (v === null) return;
        const why = prompt('علت تغییر:'); if (!why) return;
        try { await op('settings.change', {p_key: k, p_value: v, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('setmsg', esc(e.message)); } });
      return card('', table(rows.map(r => ({...r, v: esc(r.value) || '(خالی)', al: (r.allowed || []).join('، '), act: can('settings.change') ? `<button class="btn" data-set="${r.key}">تغییر</button>` : ''})),
          [['key', 'تنظیم'], ['v', 'مقدار', 'html'], ['al', 'مقادیر مجاز'], ['decision', 'تصمیم'], ['updated_by', 'آخرین تغییر'], ['act', '', 'html']]) +
        '<p class="muted">هر تغییر با علت و Audit ثبت می‌شود و فقط با تصمیم انسان مجاز است.</p><div id="setmsg"></div>');
    }
  },
  pwchange: {
    title: 'تغییر رمز', group: 'admin', agentOk: true,
    async render() {
      ctx.after = () => action('pwsave', 'pwmsg', async () => {
        if ($('#pwnew').value !== $('#pwnew2').value) throw new Error('دو رمز تازه یکی نیستند.');
        await api('/auth/password', {current_password: $('#pwcur').value, new_password: $('#pwnew').value});
        msg('pwmsg', 'رمز عوض شد.', true); setTimeout(() => { location.hash = '#/'; window.dispatchEvent(new Event('almas:restart')); }, 700);
      });
      return card('', `<div class="row"><label>رمز فعلی <input id="pwcur" type="password" autocomplete="current-password"></label>
        <label>رمز تازه (دست‌کم ۱۰ نویسه) <input id="pwnew" type="password" autocomplete="new-password"></label><label>تکرار <input id="pwnew2" type="password" autocomplete="new-password"></label>
        <button class="btn primary" id="pwsave">ذخیره</button></div><div id="pwmsg"></div>`);
    }
  },
  mfa: {
    title: 'ورود دومرحله‌ای', group: 'admin', agentOk: true,
    async render() {
      ctx.after = () => action('mfastart', 'mfamsg', async () => {
        const e = await api('/auth/mfa/enroll', {password: $('#mfapw').value}); window._mfa = e;
        $('#mfasecret').innerHTML = `<p>این کلید را در برنامه احراز هویت (مثل Google Authenticator) وارد کنید:</p><p class="mono">${e.secret.replace(/(.{4})/g, '$1 ')}</p>
          <p class="muted mono small">${esc(e.otpauth_uri)}</p><div class="row"><label>کد ۶ رقمی برنامه <input id="mfacode" size="6" inputmode="numeric"></label><button class="btn primary" id="mfaok">تأیید</button></div>`;
        action('mfaok', 'mfamsg', async () => { await api('/auth/mfa/confirm', {pending: window._mfa.pending, code: latin($('#mfacode').value)});
          msg('mfamsg', 'ورود دومرحله‌ای فعال شد. دوباره با کد وارد شوید.', true); try { await api('/auth/logout', {}); } catch (x) {} });
      });
      return card('فعال‌سازی ورود دومرحله‌ای (لازم برای مجوزهای حساس)', `<div class="row"><label>رمز <input id="mfapw" type="password"></label>
        <button class="btn primary" id="mfastart">شروع</button></div><div id="mfasecret"></div><div id="mfamsg"></div>`);
    }
  }
};
