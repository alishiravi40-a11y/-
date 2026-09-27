import {$, $$, card, ctx, dateInput, esc, fmt, latin, msg, num, one, op, options, readDate, table} from '../core.js';
import {action} from './documents.js';

const METHOD = {bank_transfer: 'بانکی', cash: 'نقد', dornatel_wallet: 'کیف پول درناتل'};
const STATE = {proposed: 'پیشنهاد قوی', conflict: 'متعارض', weak: 'ضعیف', no_candidate: 'بدون نشانه'};

export default {
  agents: {
    title: 'نمایندگان', group: 'agents', gate: 'agents.overview',
    async render(p) {
      const [ov, pend, list] = await Promise.all([op('agents.overview'), op('agents.deals_pending'), op('agents.list')]);
      ctx.after = () => {
        $('#agsel').onchange = () => location.hash = '#/agents?agent=' + $('#agsel').value;
        $$('[data-approve]').forEach(b => b.onclick = async () => { try { await op('agent.deal_approve', {p_deal: Number(b.dataset.approve)}); window.dispatchEvent(new Event('almas:refresh')); }
          catch (e) { msg('agmsg', esc(e.message)); } });
        $$('[data-reject]').forEach(b => b.onclick = async () => { const r = prompt('علت رد:'); if (!r) return;
          try { await op('agent.deal_close', {p_deal: Number(b.dataset.reject), p_status: 'rejected', p_reason: r}); window.dispatchEvent(new Event('almas:refresh')); }
          catch (e) { msg('agmsg', esc(e.message)); } });
      };
      let rep = '';
      if (p.agent) rep = table((await op('agents.report', {p_agent: Number(p.agent)})).map(r => ({...r, methods: (r.settlement_methods || []).map(m => METHOD[m] || m).join('، ') || '—'})),
        [['bank_ref', 'شناسه بانک'], ['registered_at', 'تاریخ ثبت'], ['buyer_name', 'خریدار واقعی'], ['buyer_national_id', 'کد ملی خریدار'], ['beta_total', 'مبلغ کل بتا'],
         ['base_amount', 'مبلغ پایه'], ['owed_to_agent', 'طلب'], ['settled', 'تسویه‌شده'], ['open_to_agent', 'مانده'], ['methods', 'روش تسویه'], ['state_fa', 'وضعیت']]);
      return card('سه نقش جدای هر نماینده', table(ov, [['code', 'کد'], ['title', 'نماینده'], ['sales_as_agent', 'فروش به‌عنوان نماینده'], ['buyers_beta_total', 'مبلغ کل بتای خریداران'],
          ['owed_to_agent', 'طلب نماینده'], ['open_to_agent', 'مانده تسویه‌نشده'], ['own_contracts_as_customer', 'خرید شخصی'], ['legacy_aggregate_balance', 'میراث تجمیعی هلو'],
          ['legacy_unclassified', 'میراث بی‌خریدار']], {link: r => '/agents?agent=' + r.agent_id}) +
          '<p class="muted">فروش‌های نماینده متعلق به خریداران واقعی است و بدهی شخصی او نیست. خرید شخصی او جدا شمرده می‌شود.</p>') +
        card('گزارش نماینده', `<div class="row"><label>نماینده <select id="agsel"><option value="">—</option>${options(list, 'agent_id', 'title', p.agent)}</select></label></div>` + rep) +
        card('معامله‌های در انتظار تأیید مبلغ پایه', table(pend.map(r => ({...r, bank: r.bank_ref ? `${esc(r.bank_ref)}${r.customer_matches === false ? ' ⚠ خریدار متفاوت' : ''}` : 'در بانک دیده نشده',
            act: `<button class="btn primary" data-approve="${r.deal_id}">تأیید</button> <button class="btn" data-reject="${r.deal_id}">رد</button>`})),
          [['deal_id', 'معامله'], ['agent_code', 'نماینده'], ['sale_date', 'تاریخ فروش'], ['customer_national_id', 'کد ملی خریدار'], ['goods_description', 'کالا'],
           ['base_amount', 'مبلغ پایه (ریال)'], ['evidence_ref', 'مدرک'], ['bank', 'فروش بانکی', 'html'], ['beta_total', 'مبلغ کل بتا'], ['act', '', 'html']]) +
          '<p class="muted">تأیید، دقیقاً «مبلغ پایه» را طلب نماینده می‌کند، نه مبلغ کل بتا. تفاوت این دو سود حساب نمی‌شود (D-26).</p><div id="agmsg"></div>');
    }
  },
  attrib: {
    title: 'انتساب فروش بانک', group: 'agents', gate: 'agents.attribution_queue',
    async render() {
      const [q, list] = await Promise.all([op('agents.attribution_queue', {p_limit: 200}), op('agents.list')]);
      ctx.after = () => {
        $$('[data-ok]').forEach(b => b.onclick = async () => { const r = q[Number(b.dataset.ok)];
          try { await op('agent.attribute', {p_scheme: r.scheme_id, p_source: r.source, p_ref: r.ref, p_agent: r.proposed_agent_id, p_deal: r.proposed_deal_id, p_method: 'auto'});
                window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('qmsg', esc(e.message)); } });
        $$('[data-man]').forEach(b => b.onclick = async () => { const i = Number(b.dataset.man), r = q[i], a = $('#qa' + i).value; if (!a) return;
          const why = prompt('علت انتساب دستی (مدرک):'); if (!why) return;
          try { await op('agent.attribute', {p_scheme: r.scheme_id, p_source: r.source, p_ref: r.ref, p_agent: Number(a), p_deal: null, p_method: 'manual', p_reason: why});
                window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('qmsg', esc(e.message)); } });
      };
      const rows = q.map((r, i) => ({...r, st: STATE[r.state] || r.state, act: r.state === 'proposed' ? `<button class="btn primary" data-ok="${i}">تأیید پیشنهاد</button>`
        : `<select id="qa${i}"><option value="">نماینده…</option>${options(list, 'agent_id', 'code')}</select> <button class="btn" data-man="${i}">انتساب با علت</button>`}));
      return card('', table(rows, [['ref', 'شناسه بانک'], ['registered_at', 'تاریخ ثبت'], ['national_id', 'کد ملی خریدار'], ['total_amount', 'مبلغ کل'], ['st', 'وضعیت'],
          ['proposed_agent_code', 'نماینده پیشنهادی'], ['reasons', 'دلیل'], ['act', '', 'html']]) +
        '<p class="muted">هیچ فروشی حدسی منتسب نمی‌شود: پیشنهاد فقط از شناسه اعلام‌شده نماینده، ثبت‌کننده پنل طبق نگاشت الماس، یا خریدار و تاریخ ساخته می‌شود.</p><div id="qmsg"></div>');
    }
  },
  agentpay: {
    title: 'تسویه با نماینده', group: 'agents', gate: 'agent.settle',
    async render(p) {
      const [list, banks] = await Promise.all([op('agents.list'), op('bank_accounts.list')]);
      ctx.after = () => {
        $('#psel').onchange = () => location.hash = '#/agentpay?agent=' + $('#psel').value;
        action('psave', 'pmsg', async () => {
          const alloc = $$('input[data-ent]').map(i => ({entitlement_id: Number(i.dataset.ent), amount: Number(latin(i.value))})).filter(a => a.amount > 0);
          const amount = alloc.reduce((a, x) => a + x.amount, 0), method = $('#pmethod').value, ref = $('#pref').value.trim();
          if (!amount) throw new Error('مبلغی برای پرداخت انتخاب نشده است.');
          if (!ref) throw new Error(method === 'dornatel_wallet' ? 'شناسه تراکنش درناتل لازم است.' : 'مرجع پرداخت بانکی لازم است.');
          const args = {p_agent: Number(p.agent), p_method: method, p_amount: amount, p_paid_at: readDate('pdate'), p_allocations: alloc};
          if (method === 'bank_transfer') Object.assign(args, {p_bank_account: Number($('#pbank').value), p_bank_ref: ref});
          else Object.assign(args, {p_dornatel_txn_ref: ref, p_wallet_account_ref: $('#pwallet').value.trim()});
          await op('agent.settle', args);
          window.dispatchEvent(new Event('almas:refresh'));
        });
      };
      let out = `<div class="row"><label>نماینده <select id="psel"><option value="">—</option>${options(list, 'agent_id', 'title', p.agent)}</select></label></div>`;
      if (!p.agent) return card('', out);
      const ents = await op('agents.open_entitlements', {p_agent: Number(p.agent)});
      return card('', out + table(ents.map(r => ({...r, pay: `<input inputmode="numeric" value="${r.open_amount}" data-ent="${r.entitlement_id}" size="14">`})),
          [['deal_id', 'معامله'], ['customer_national_id', 'کد ملی خریدار'], ['amount', 'طلب'], ['settled', 'تسویه‌شده'], ['open_amount', 'مانده'], ['pay', 'پرداخت این بار', 'html']],
          {empty: 'طلب باز ندارد.'}) +
        `<div class="row">${dateInput('pdate')}<label>روش <select id="pmethod"><option value="bank_transfer">انتقال بانکی</option><option value="dornatel_wallet">شارژ کیف پول درناتل</option></select></label>
          <label>از حساب بانکی الماس <select id="pbank">${options(banks, 'bank_account_id', 'title')}</select></label>
          <label>مرجع پرداخت / شناسه تراکنش درناتل <input id="pref" size="16"></label><label>حساب کیف پول <input id="pwallet" size="10"></label>
          <button class="btn primary" id="psave">ثبت تسویه</button></div><div id="pmsg"></div>`);
    }
  },
  mydeals: {
    title: 'معامله‌های من', group: 'agent', gate: 'agent.my_deals',
    async render() {
      const rows = await op('agent.my_deals');
      ctx.after = () => action('dsave', 'dmsg', async () => {
        const id = one(await op('agent.deal_declare', {p_national_id: latin($('#dnc').value), p_customer_name: $('#dname').value, p_sale_date: readDate('ddate'),
          p_goods: $('#dgoods').value, p_base_amount: num('dbase'), p_base_source: 'agent_invoice', p_evidence_ref: $('#devid').value,
          p_declared_beta_total: num('dtotal'), p_declared_order_ref: latin($('#dref').value) || null}));
        msg('dmsg', `معامله ${fmt(id)} ثبت شد و در انتظار تأیید الماس است.`, true); setTimeout(() => window.dispatchEvent(new Event('almas:refresh')), 900);
      });
      return card('اعلام فروش انجام‌شده در پنل بانک', `<div class="row">${dateInput('ddate')}
          <label>کد ملی خریدار <input id="dnc" size="12" inputmode="numeric"></label><label>نام خریدار <input id="dname" size="18"></label>
          <label>کالا <input id="dgoods" size="18"></label><label>مبلغ پایه کالا (ریال) <input id="dbase" inputmode="numeric" size="16"></label>
          <label>شماره فاکتور/مدرک <input id="devid" size="12"></label></div>
        <div class="row"><label>مبلغ کل قرارداد در پنل (اختیاری) <input id="dtotal" inputmode="numeric" size="16"></label>
          <label>شناسه فروش در پنل (اختیاری) <input id="dref" size="12"></label><button class="btn primary" id="dsave">ثبت اعلام</button></div><div id="dmsg"></div>
        <p class="muted">مبلغ پایه پس از تأیید الماس طلب شما می‌شود و معمولاً ظرف ۲۴ ساعت تسویه می‌شود.</p>`) +
        card('معامله‌های من', table(rows.map(r => ({...r, bank: r.matched_with_bank ? 'بله' : 'هنوز نه'})), [['deal_id', 'معامله'], ['sale_date', 'تاریخ'],
          ['customer_name', 'خریدار'], ['goods', 'کالا'], ['base_amount', 'مبلغ پایه'], ['status_fa', 'وضعیت'], ['bank', 'دیده شده در بانک'], ['owed', 'طلب'],
          ['paid_by_bank', 'پرداخت بانکی'], ['paid_by_wallet', 'کیف پول درناتل'], ['open_amount', 'مانده']]));
    }
  },
  mycases: {
    title: 'مشتریان و پرونده‌های من', group: 'agent', gate: 'agent.my_cases',
    async render() {
      const [cases, cust] = await Promise.all([op('agent.my_cases'), op('agent.my_customers')]);
      return card('پرونده‌های من', table(cases, [['beta_order_id', 'شناسه بانک'], ['customer_name', 'خریدار'], ['total_amount', 'مبلغ کل'], ['installments', 'اقساط'],
          ['paid_count', 'پرداخت‌شده'], ['overdue_count', 'معوق'], ['outstanding', 'مانده مشتری'], ['next_due', 'سررسید بعدی'], ['next_amount', 'مبلغ قسط بعدی']])) +
        card('مشتریان من', table(cust, [['name', 'نام'], ['national_id', 'کد ملی'], ['contracts', 'قرارداد'], ['outstanding', 'مانده'], ['overdue_count', 'قسط معوق']]));
    }
  }
};
