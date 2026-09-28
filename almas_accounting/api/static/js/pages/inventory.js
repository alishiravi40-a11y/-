import {$, $$, card, ctx, dateInput, esc, fmt, latin, lookup, msg, num, one, op, options, picked, readDate, table, todayIso, can} from '../core.js';
import {action} from './documents.js';

const KIND = {opening: 'اول دوره', purchase: 'خرید', sale: 'فروش', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید', waste: 'ضایعات',
              transfer_in: 'انتقال (ورود)', transfer_out: 'انتقال (خروج)'};

export default {
  stock: {
    title: 'کالا و موجودی', group: 'stock', gate: 'stock.list',
    async render(p) {
      const [rows, wh] = await Promise.all([op('stock.list', {p_query: p.q || null, p_warehouse: p.w ? Number(p.w) : null, p_limit: 300}), op('warehouses.list')]);
      ctx.after = () => { $('#sgo').onclick = () => location.hash = `#/stock?q=${encodeURIComponent(latin($('#sq').value))}&w=${$('#sw').value}`; };
      return card('', `<div class="row"><label>کالا <input id="sq" value="${esc(p.q || '')}" size="20"></label>
          <label>انبار <select id="sw"><option value="">همه</option>${options(wh, 'warehouse_id', 'name', p.w)}</select></label><button class="btn" id="sgo">نمایش</button>
          ${can('items.save') ? '<a class="btn primary" href="#/item/new">+ کالای تازه</a>' : ''} ${can('stock.transfer') ? '<a class="btn" href="#/transfer">انتقال بین انبارها</a>' : ''} ${can('stock.waste') ? '<a class="btn" href="#/waste">ضایعات و کسری</a>' : ''}</div>` +
        table(rows, [['code', 'کد'], ['name', 'کالا'], ['warehouse_name', 'انبار'], ['qty', 'موجودی'], ['last_movement', 'آخرین گردش']], {link: r => '/item/' + r.item_id}));
    }
  },
  item: {
    title: 'کالا', group: 'stock', menu: false, gate: 'stock.list',
    async render(p) {
      const isNew = p.id === 'new', d = isNew ? {item: {}, stock: [], movements: []} : one(await op('items.detail', {p_item: Number(p.id)}));
      const it = d.item || {};
      ctx.after = () => { $$('[data-trev]').forEach(b => b.onclick = async () => { const why = prompt('علت برگشت این انتقال:'); if (!why) return;
          try { await op('stock.transfer_reverse', {p_transfer: Number(b.dataset.trev), p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('imsg', esc(e.message)); } });
        $$('[data-wrev]').forEach(b => b.onclick = async () => { const why = prompt('علت برگشت این ضایعات (کالا به انبار برمی‌گردد و سندش برگشت می‌خورد):'); if (!why) return;
          try { await op('stock.waste_reverse', {p_movement: Number(b.dataset.wrev), p_date: todayIso, p_reason: why}); window.dispatchEvent(new Event('almas:refresh')); } catch (e) { msg('imsg', esc(e.message)); } });
        action('isave', 'imsg', async () => {
        const id = one(await op('items.save', {p_item: isNew ? null : Number(p.id), p_code: $('#icode').value || null, p_name: $('#iname').value, p_unit: $('#iunit').value || null,
                                               p_is_service: $('#isvc').checked}));
        location.hash = '#/item/' + id;
      }); };
      const form = `<div class="row"><label>نام <input id="iname" value="${esc(it.name || '')}" size="28"></label><label>کد <input id="icode" value="${esc(it.code || '')}" size="10" ${isNew ? '' : 'disabled'}></label>
        <label>واحد <input id="iunit" value="${esc(it.unit || '')}" size="6"></label><label><input type="checkbox" id="isvc" ${it.is_service ? 'checked' : ''}> خدمت (بدون موجودی)</label>
        ${can('items.save') ? '<button class="btn primary" id="isave">ذخیره</button>' : ''}</div><div id="imsg"></div>`;
      if (isNew) return card('کالای تازه', form);
      return card(esc(it.name), form) +
        card('موجودی و ارزش', table(d.stock, [['warehouse', 'انبار'], ['qty', 'موجودی'], ['avg_cost', 'میانگین بها'], ['value', 'ارزش']], {totals: ['qty', 'value']}) +
             '<p class="muted">بها از کاردکس محاسبه می‌شود (میانگین موزون متحرک)؛ ذخیره نمی‌شود و با هر گردش تازه به‌روز است.</p>') +
        card('کاردکس (۵۰ گردش آخر)', table(d.movements.map(m => ({...m, k: KIND[m.kind] || m.kind,
             rev: m.transfer_id && can('stock.transfer_reverse') ? `<button class="btn" data-trev="${m.transfer_id}">برگشت انتقال</button>`
                : m.waste_id && can('stock.waste_reverse') ? `<button class="btn" data-wrev="${m.waste_id}">برگشت ضایعات</button>` : ''})),
             [['date', 'تاریخ'], ['k', 'نوع'], ['warehouse', 'انبار'], ['qty', 'مقدار'], ['unit_cost', 'بهای واحد'], ['qty_after', 'مانده'], ['rev', '', 'html']]));
    }
  },
  waste: {
    title: 'ضایعات و کسری انبار', group: 'stock', gate: 'stock.waste',
    async render() {
      const wh = await op('warehouses.list');
      ctx.after = () => {
        lookup('witem', 'items.find', 'item_id', 'name');
        action('wsave', 'wmsg', async () => {
          if (!picked.witem) throw new Error('کالا را از فهرست انتخاب کنید.');
          const why = $('#wreason').value.trim(); if (why.length < 3) throw new Error('علت (مثلاً «شکسته در حمل» یا «کسری انبارگردانی») لازم است.');
          await op('stock.waste', {p_item: picked.witem, p_warehouse: Number($('#wwh').value), p_qty: num('wqty'), p_date: readDate('wdate'), p_reason: why});
          msg('wmsg', `ثبت شد. <a href="#/item/${picked.witem}">کارت کالا و کاردکس</a>`, true);
        });
      };
      return card('', `<div class="row">${dateInput('wdate')}<label>کالا <input id="witem" size="24"></label><label>انبار <select id="wwh">${options(wh, 'warehouse_id', 'name')}</select></label>
        <label>تعداد <input id="wqty" inputmode="decimal" size="6"></label><label>علت <input id="wreason" size="26"></label><button class="btn primary" id="wsave">ثبت ضایعات</button></div><div id="wmsg"></div>
        <p class="muted">کالا به بهای میانگین موزون همان لحظه از انبار خارج می‌شود و سند «هزینه ضایعات / خرید» ساخته می‌شود (همان قاعده هلو). بیش از موجودی پذیرفته نمی‌شود. اشتباه با «برگشت ضایعات» در کارت کالا اصلاح می‌شود.</p>`);
    }
  },
  transfer: {
    title: 'انتقال بین انبارها', group: 'stock', gate: 'stock.transfer',
    async render() {
      const wh = await op('warehouses.list');
      ctx.after = () => {
        lookup('titem', 'items.find', 'item_id', 'name');
        action('tsave', 'tmsg', async () => {
          if (!picked.titem) throw new Error('کالا را از فهرست انتخاب کنید.');
          const t = one(await op('stock.transfer', {p_item: picked.titem, p_from: Number($('#tfrom').value), p_to: Number($('#tto').value), p_qty: num('tqty'),
                                                   p_date: readDate('tdate'), p_note: $('#tnote').value || null}));
          msg('tmsg', `انتقال ثبت شد (شماره ${esc(t)}).`, true);
        });
      };
      return card('', `<div class="row">${dateInput('tdate')}<label>کالا <input id="titem" size="24"></label><label>از انبار <select id="tfrom">${options(wh, 'warehouse_id', 'name')}</select></label>
        <label>به انبار <select id="tto">${options(wh, 'warehouse_id', 'name')}</select></label><label>تعداد <input id="tqty" inputmode="decimal" size="6"></label>
        <label>توضیح <input id="tnote" size="18"></label><button class="btn primary" id="tsave">ثبت انتقال</button></div><div id="tmsg"></div>
        <p class="muted">موجودی منفی پذیرفته نمی‌شود. انتقال اشتباه با «برگشت انتقال» خنثی می‌شود.</p>`);
    }
  }
};
