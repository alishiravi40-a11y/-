// Router, navigation, sign-in and global search. Pages live in ./pages/*.js and register themselves in ROUTES.
import {$, $$, api, esc, keep, latin, op, session, persian, ctx} from './core.js';
import home from './pages/home.js';
import docs from './pages/documents.js';
import ledger from './pages/ledger.js';
import treasury from './pages/treasury.js';
import inventory from './pages/inventory.js';
import agents from './pages/agents.js';
import admin from './pages/admin.js';
import holoo from './pages/holoo.js';

// route → {title, group, gate (catalogued operation that must be permitted), render(params) → html, after?}
export const ROUTES = {...home, ...docs, ...ledger, ...treasury, ...inventory, ...agents, ...admin, ...holoo};
const GROUPS = [['home', 'میز کار'], ['daily', 'عملیات روزانه'], ['books', 'اشخاص و دفاتر'], ['money', 'بانک، صندوق و چک'], ['stock', 'کالا و انبار'],
                ['agents', 'نمایندگان و بتا'], ['reports', 'گزارش‌ها'], ['holoo', 'هلو'], ['admin', 'مدیریت'], ['agent', 'نماینده']];


function parse() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, '')) || '';
  const [path, query] = h.split('?'); const [name, id] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query || '')); if (id) params.id = id;
  return {name: name || (session.agent ? 'mydeals' : 'dashboard'), params};
}
const visible = r => r.menu !== false && (session.agent ? r.group === 'agent' || r.agentOk : r.group !== 'agent') && (!r.gate || session.ops.get(r.gate) === true);

function drawNav() {
  const cur = parse().name;
  $('#nav').innerHTML = GROUPS.map(([g, title]) => {
    const items = Object.entries(ROUTES).filter(([, r]) => r.group === g && visible(r));
    return items.length ? `<div class="navgroup"><div class="navtitle">${title}</div>` +
      items.map(([k, r]) => `<a href="#/${k}" class="${k === cur ? 'on' : ''}">${r.title}</a>`).join('') + '</div>' : '';
  }).join('');
}

export async function render() {
  const {name, params} = parse();
  drawNav();
  if (!session.user) { $('#view').innerHTML = '<p class="muted">نام کاربری و رمز را وارد کنید.</p>'; return; }
  const r = ROUTES[name];
  if (!r) { $('#view').innerHTML = '<p class="err">صفحه پیدا نشد.</p>'; return; }
  if (r.gate && session.ops.get(r.gate) !== true) { $('#view').innerHTML = '<p class="err">این بخش برای شما مجاز نیست.</p>'; return; }
  document.title = r.title + ' — حسابداری الماس شهر';
  $('#view').innerHTML = '<p class="muted">در حال بارگذاری…</p>';
  ctx.after = null;
  try {
    $('#view').innerHTML = `<h1 class="pagetitle">${r.heading ? r.heading(params) : r.title}</h1>` + await r.render(params);
    if (ctx.after) await ctx.after();
  } catch (e) {
    if (e.status === 403 && /password change/.test(e.raw || '')) return force('pwchange');
    if (e.status === 403 && /second factor/.test(e.raw || '')) return force('mfa');
    $('#view').innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}
async function force(page) { location.hash = '#/' + page; ctx.after = null; $('#view').innerHTML = await ROUTES[page].render({}); if (ctx.after) await ctx.after(); }

export async function start() {
  session.ops = new Map(); session.agent = false;
  $('#who').textContent = session.user || '';
  if (session.user) {
    try {
      const ops = await api('/operations');
      ops.forEach(o => session.ops.set(o.operation, o.permitted));
      session.agent = !session.ops.has('controls.inbox');
    } catch (e) {
      if (e.status === 403 && /password change/.test(e.raw || '')) { drawNav(); return force('pwchange'); }
      if (e.status === 403 && /second factor/.test(e.raw || '')) { drawNav(); return force('mfa'); }
      if (e.status === 401) { session.user = ''; keep('almas_user', ''); $('#view').innerHTML = `<p class="err">${esc(e.message)}</p>`; drawNav(); return; }
    }
  }
  $('#search').hidden = !session.user || session.agent;
  render();
}

// ---- sign-in ----
$('#login').onclick = async () => {
  const user = $('#user').value.trim(), pw = $('#pass').value;
  session.user = user; keep('almas_user', user); session.token = ''; keep('almas_token', '');
  if (pw) {
    try { const r = await api('/auth/login', {username: user, password: pw, otp: latin($('#otp').value.trim()) || null}); session.token = r.token; keep('almas_token', r.token); }
    catch (e) { session.user = ''; keep('almas_user', ''); $('#view').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    finally { $('#pass').value = ''; $('#otp').value = ''; }
  }
  $('#loginbox').hidden = true; $('#userbox').hidden = false;
  location.hash = '#/'; start();
};
$('#print').onclick = () => window.print();
$('#logout').onclick = async () => {
  try { if (session.token) await api('/auth/logout', {}); } catch (e) {}
  session.token = ''; session.user = ''; keep('almas_token', ''); keep('almas_user', '');
  $('#loginbox').hidden = false; $('#userbox').hidden = true; session.ops = new Map(); start();
};
$('#loginbox').hidden = !!session.user; $('#userbox').hidden = !session.user;
$('#pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login').click(); });
$('#otp').addEventListener('keydown', e => { if (e.key === 'Enter') $('#login').click(); });

// ---- one search box for everything ----
const SEARCH_HREF = {party: id => '#/party/' + id, item: id => '#/item/' + id, entry: id => '#/entry/' + id, cheque: () => '#/cheques',
                     sales_invoice: id => '#/document?source=sales_invoice&ref=' + id};
const SEARCH_KIND = {party: 'شخص', item: 'کالا', entry: 'سند', sales_invoice: 'فاکتور', cheque: 'چک'};
let timer;
$('#q').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const q = latin($('#q').value).trim(); if (q.length < 2) { $('#results').hidden = true; return; }
    try {
      const rows = await op('search', {p_query: q, p_limit: 6});
      $('#results').innerHTML = rows.length ? rows.map(r => `<a href="${SEARCH_HREF[r.kind](r.id)}"><b>${SEARCH_KIND[r.kind]}</b> ${esc(r.title)} <span class="muted">${esc(r.detail)}</span></a>`).join('')
                                            : '<p class="muted">چیزی پیدا نشد</p>';
      $('#results').hidden = false;
    } catch (e) { $('#results').hidden = true; }
  }, 250);
});
document.addEventListener('click', e => { if (!e.target.closest('#search')) $('#results').hidden = true; });
window.addEventListener('hashchange', () => { $('#results').hidden = true; render(); });
window.addEventListener('almas:refresh', render);
window.addEventListener('almas:restart', start);
start();
