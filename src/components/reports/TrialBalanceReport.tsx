import React, { useMemo } from 'react';
import { CheckCircle, FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AppState } from '../../types';
import { useCoaReadModel } from '../../services/CoaReadService';

interface TrialBalanceReportProps {
  state: AppState;
  startDate: string;
  endDate: string;
  isFilterSubmitted: boolean;
  trialBalanceType: '4_column' | '6_column' | '8_column';
  setTrialBalanceType: (val: '4_column' | '6_column' | '8_column') => void;
  trialBalanceLevel: 'general' | 'subsidiary' | 'detailed';
  setTrialBalanceLevel: (val: 'general' | 'subsidiary' | 'detailed') => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
}

export default function TrialBalanceReport({
  state,
  startDate,
  endDate,
  isFilterSubmitted,
  trialBalanceType,
  setTrialBalanceType,
  trialBalanceLevel,
  setTrialBalanceLevel,
}: TrialBalanceReportProps) {
  const { subsidiaries: activeSubsidiaries } = useCoaReadModel(state.subsidiaries);

  // DYNAMIC TRIAL BALANCE COMPILER
  const trialBalanceResult = useMemo(() => {
    if (!isFilterSubmitted) return null;

    const generalMap: Record<string, { code: string; name: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};
    const subsidiaryMap: Record<string, { code: string; name: string; genCode: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};
    const detailedMap: Record<string, { code: string; name: string; subId: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }> = {};

    function getGeneralAccountName(genCode: string, defaultName: string): string {
      const map: Record<string, string> = {
        '101': "موجودی نقدی و بانک - بانک‌ها",
        '102': "موجودی نقدی و بانک - صندوق‌ها",
        '103': "حساب‌های دریافتنی (بدهکاران تجاری)",
        '104': "اسناد دریافتنی و در جریان وصول",
        '105': "موجودی کالا (انبار)",
        '106': "پیش‌پرداخت‌ها و دارایی‌های جاری دیگر",
        '201': "اسناد پرداختنی (چک‌های صادره)",
        '202': "حساب‌های پرداختنی (بستانکاران تجاری)",
        '203': "پیش‌دریافت‌ها و بدهی‌های جاری دیگر",
        '204': "تسهیلات و استقراض‌های دریافتی",
        '501': "سرمایه و جاری شرکا",
        '601': "درآمدهای عملیاتی و فروش",
        '602': "سایر درآمدها و کارمزد",
        '701': "بهای تمام شده کالای فروش رفته",
        '702': "هزینه‌های عمومی، اداری و تشکیلاتی",
        '703': "هزینه‌های مالی و بهره پرداختی",
        '999': "تراز افتتاحیه"
      };
      return map[genCode] || defaultName || `حساب کل ${genCode}`;
    }

    // Initialize maps
    activeSubsidiaries.forEach(sub => {
      const genCode = sub.code.slice(0, 3);
      subsidiaryMap[sub.id] = {
        code: sub.code,
        name: sub.name,
        genCode,
        rawPrevDebit: 0,
        rawPrevCredit: 0,
        rawTurnoverDebit: 0,
        rawTurnoverCredit: 0,
      };

      if (!generalMap[genCode]) {
        generalMap[genCode] = {
          code: genCode,
          name: getGeneralAccountName(genCode, sub.generalType),
          rawPrevDebit: 0,
          rawPrevCredit: 0,
          rawTurnoverDebit: 0,
          rawTurnoverCredit: 0,
        };
      }
    });

    // Populate from vouchers
    state.vouchers.forEach(v => {
      v.entries.forEach(e => {
        const sub = activeSubsidiaries.find(s => s.id === e.subsidiaryId);
        if (!sub) return;

        const genCode = sub.code.slice(0, 3);
        const debit = e.debit || 0;
        const credit = e.credit || 0;

        const isPrev = v.date < startDate;
        const isDuring = v.date >= startDate && v.date <= endDate;

        // Subsidiary
        if (!subsidiaryMap[sub.id]) {
          subsidiaryMap[sub.id] = {
            code: sub.code,
            name: sub.name,
            genCode,
            rawPrevDebit: 0,
            rawPrevCredit: 0,
            rawTurnoverDebit: 0,
            rawTurnoverCredit: 0,
          };
        }
        if (isPrev) {
          subsidiaryMap[sub.id].rawPrevDebit += debit;
          subsidiaryMap[sub.id].rawPrevCredit += credit;
        } else if (isDuring) {
          subsidiaryMap[sub.id].rawTurnoverDebit += debit;
          subsidiaryMap[sub.id].rawTurnoverCredit += credit;
        }

        // General
        if (!generalMap[genCode]) {
          generalMap[genCode] = {
            code: genCode,
            name: getGeneralAccountName(genCode, sub.generalType),
            rawPrevDebit: 0,
            rawPrevCredit: 0,
            rawTurnoverDebit: 0,
            rawTurnoverCredit: 0,
          };
        }
        if (isPrev) {
          generalMap[genCode].rawPrevDebit += debit;
          generalMap[genCode].rawPrevCredit += credit;
        } else if (isDuring) {
          generalMap[genCode].rawTurnoverDebit += debit;
          generalMap[genCode].rawTurnoverCredit += credit;
        }

        // Detailed (if exists)
        if (e.floatingDetailed) {
          const detailedId = e.floatingDetailed.id;
          const detailedName = e.floatingDetailed.name;
          const type = e.floatingDetailed.type;
          const detailedKey = `${sub.id}_${type}_${detailedId}`;

          if (!detailedMap[detailedKey]) {
            const shortId = detailedId.slice(-4).toUpperCase();
            const detailedCode = `${sub.code}-${shortId}`;
            detailedMap[detailedKey] = {
              code: detailedCode,
              name: detailedName,
              subId: sub.id,
              rawPrevDebit: 0,
              rawPrevCredit: 0,
              rawTurnoverDebit: 0,
              rawTurnoverCredit: 0,
            };
          }

          if (isPrev) {
            detailedMap[detailedKey].rawPrevDebit += debit;
            detailedMap[detailedKey].rawPrevCredit += credit;
          } else if (isDuring) {
            detailedMap[detailedKey].rawTurnoverDebit += debit;
            detailedMap[detailedKey].rawTurnoverCredit += credit;
          }
        }
      });
    });

    // Post-process detailedMap to offset person balances across subsidiaries as requested
    const personDetailedGroups: Record<string, { key: string; subId: string; entry: any }[]> = {};

    Object.entries(detailedMap).forEach(([key, entry]) => {
      const parts = key.split('_');
      const personIndex = parts.indexOf('person');
      if (personIndex !== -1) {
        const personId = parts.slice(personIndex + 1).join('_');
        if (!personDetailedGroups[personId]) {
          personDetailedGroups[personId] = [];
        }
        const subId = parts.slice(0, personIndex).join('_');
        personDetailedGroups[personId].push({ key, subId, entry });
      }
    });

    Object.entries(personDetailedGroups).forEach(([_personId, group]) => {
      let sumPrevDebit = 0;
      let sumPrevCredit = 0;
      let sumTurnoverDebit = 0;
      let sumTurnoverCredit = 0;

      group.forEach(g => {
        sumPrevDebit += g.entry.rawPrevDebit;
        sumPrevCredit += g.entry.rawPrevCredit;
        sumTurnoverDebit += g.entry.rawTurnoverDebit;
        sumTurnoverCredit += g.entry.rawTurnoverCredit;
      });

      const netPrev = sumPrevDebit - sumPrevCredit;
      const netTurnover = sumTurnoverDebit - sumTurnoverCredit;
      const netEnd = (sumPrevDebit + sumTurnoverDebit) - (sumPrevCredit + sumTurnoverCredit);

      let targetSubId = 'SUB_DEBTORS';
      if (netEnd < 0) {
        targetSubId = 'SUB_CREDITORS';
      } else {
        const hasInstallment = group.some(g => g.subId === 'SUB_DEBTORS_INSTALLMENT');
        if (hasInstallment) {
          targetSubId = 'SUB_DEBTORS_INSTALLMENT';
        }
      }

      group.forEach(g => {
        if (g.subId === targetSubId) {
          g.entry.rawPrevDebit = netPrev > 0 ? netPrev : 0;
          g.entry.rawPrevCredit = netPrev < 0 ? Math.abs(netPrev) : 0;
          g.entry.rawTurnoverDebit = netTurnover > 0 ? netTurnover : 0;
          g.entry.rawTurnoverCredit = netTurnover < 0 ? Math.abs(netTurnover) : 0;
        } else {
          g.entry.rawPrevDebit = 0;
          g.entry.rawPrevCredit = 0;
          g.entry.rawTurnoverDebit = 0;
          g.entry.rawTurnoverCredit = 0;
        }
      });
    });

    function calculateRow(raw: { code: string; name: string; rawPrevDebit: number; rawPrevCredit: number; rawTurnoverDebit: number; rawTurnoverCredit: number }) {
      const prevNet = raw.rawPrevDebit - raw.rawPrevCredit;
      const prevDebit = prevNet > 0 ? prevNet : 0;
      const prevCredit = prevNet < 0 ? Math.abs(prevNet) : 0;

      const turnoverDebit = raw.rawTurnoverDebit;
      const turnoverCredit = raw.rawTurnoverCredit;

      const totalDebit = prevDebit + turnoverDebit;
      const totalCredit = prevCredit + turnoverCredit;

      const endNet = (raw.rawPrevDebit + raw.rawTurnoverDebit) - (raw.rawPrevCredit + raw.rawTurnoverCredit);
      const endDebit = endNet > 0 ? endNet : 0;
      const endCredit = endNet < 0 ? Math.abs(endNet) : 0;

      return {
        code: raw.code,
        name: raw.name,
        prevDebit,
        prevCredit,
        turnoverDebit,
        turnoverCredit,
        totalDebit,
        totalCredit,
        endDebit,
        endCredit,
        rawPrevDebit: raw.rawPrevDebit,
        rawPrevCredit: raw.rawPrevCredit,
        rawTurnoverDebit: raw.rawTurnoverDebit,
        rawTurnoverCredit: raw.rawTurnoverCredit,
      };
    }

    const hasActivity = (row: any) => {
      return (
        row.rawPrevDebit > 0 ||
        row.rawPrevCredit > 0 ||
        row.rawTurnoverDebit > 0 ||
        row.rawTurnoverCredit > 0
      );
    };

    const rows: any[] = [];
    const sortedGenCodes = Object.keys(generalMap).sort((a, b) => a.localeCompare(b));

    sortedGenCodes.forEach(genCode => {
      const genRaw = generalMap[genCode];
      const genRow = { ...calculateRow(genRaw), level: 'general' };

      if (!hasActivity(genRow)) return;

      if (trialBalanceLevel === 'general') {
        rows.push(genRow);
        return;
      }

      const subRows = Object.entries(subsidiaryMap)
        .filter(([_, subRaw]) => subRaw.genCode === genCode)
        .map(([id, subRaw]) => ({ ...calculateRow(subRaw), id, level: 'subsidiary', parentCode: genCode }))
        .filter(hasActivity)
        .sort((a, b) => a.code.localeCompare(b.code));

      if (subRows.length === 0) return;

      rows.push(genRow);

      subRows.forEach(subRow => {
        rows.push(subRow);

        if (trialBalanceLevel === 'detailed') {
          const detRows = Object.entries(detailedMap)
            .filter(([_, detRaw]) => detRaw.subId === subRow.id)
            .map(([_, detRaw]) => ({ ...calculateRow(detRaw), level: 'detailed', parentCode: subRow.code }))
            .filter(hasActivity)
            .sort((a, b) => a.code.localeCompare(b.code));

          detRows.forEach(detRow => {
            rows.push(detRow);
          });
        }
      });
    });

    let totalPrevDebit = 0;
    let totalPrevCredit = 0;
    let totalTurnoverDebit = 0;
    let totalTurnoverCredit = 0;
    let totalCumDebit = 0;
    let totalCumCredit = 0;
    let totalEndDebit = 0;
    let totalEndCredit = 0;

    rows.forEach((r, i) => {
      let isLeaf = false;
      if (trialBalanceLevel === 'general') {
        if (r.level === 'general') isLeaf = true;
      } else if (trialBalanceLevel === 'subsidiary') {
        if (r.level === 'subsidiary') isLeaf = true;
      } else if (trialBalanceLevel === 'detailed') {
        if (r.level === 'detailed') {
          isLeaf = true;
        } else if (r.level === 'subsidiary') {
          const hasDetailedChildren = i < rows.length - 1 && rows[i + 1].level === 'detailed';
          if (!hasDetailedChildren) {
            isLeaf = true;
          }
        }
      }

      if (isLeaf) {
        totalPrevDebit += r.prevDebit || 0;
        totalPrevCredit += r.prevCredit || 0;
        totalTurnoverDebit += r.turnoverDebit || 0;
        totalTurnoverCredit += r.turnoverCredit || 0;
        totalCumDebit += r.totalDebit || 0;
        totalCumCredit += r.totalCredit || 0;
        totalEndDebit += r.endDebit || 0;
        totalEndCredit += r.endCredit || 0;
      }
    });

    const isPrevBalanced = Math.abs(totalPrevDebit - totalPrevCredit) < 1;
    const isTurnoverBalanced = Math.abs(totalTurnoverDebit - totalTurnoverCredit) < 1;
    const isTotalBalanced = Math.abs(totalCumDebit - totalCumCredit) < 1;
    const isEndBalanced = Math.abs(totalEndDebit - totalEndCredit) < 1;
    const isBalanced = isPrevBalanced && isTurnoverBalanced && isTotalBalanced && isEndBalanced;

    return {
      rows,
      totals: {
        totalPrevDebit,
        totalPrevCredit,
        totalTurnoverDebit,
        totalTurnoverCredit,
        totalCumDebit,
        totalCumCredit,
        totalEndDebit,
        totalEndCredit,
      },
      isBalanced,
    };
  }, [isFilterSubmitted, state.vouchers, activeSubsidiaries, startDate, endDate, trialBalanceLevel]);

  // Excel Export Handler for Trial Balance
  const handleExportExcel = () => {
    if (!trialBalanceResult) return;

    const wsData = [
      ["گزارش تراز آزمایشی پویا"],
      [`دوره گزارش: از ${startDate} تا ${endDate}`],
      [`سطح گزارش: ${
        trialBalanceLevel === 'general' ? 'حساب‌های کل' : trialBalanceLevel === 'subsidiary' ? 'حساب‌های معین' : 'حساب‌های تفصیلی'
      }`],
      [], // Blank line
    ];

    if (trialBalanceType === '4_column') {
      wsData.push([
        "کد حساب",
        "نام و شرح حساب",
        "گردش طی دوره - بدهکار (ریال)",
        "گردش طی دوره - بستانکار (ریال)",
        "مانده نهایی - بدهکار (ریال)",
        "مانده نهایی - بستانکار (ریال)"
      ]);
    } else if (trialBalanceType === '6_column') {
      wsData.push([
        "کد حساب",
        "نام و شرح حساب",
        "مانده قبلی - بدهکار (ریال)",
        "مانده قبلی - بستانکار (ریال)",
        "گردش طی دوره - بدهکار (ریال)",
        "گردش طی دوره - بستانکار (ریال)",
        "مانده نهایی - بدهکار (ریال)",
        "مانده نهایی - بستانکار (ریال)"
      ]);
    } else {
      wsData.push([
        "کد حساب",
        "نام و شرح حساب",
        "گردش ابتدای دوره - بدهکار (ریال)",
        "گردش ابتدای دوره - بستانکار (ریال)",
        "گردش طی دوره - بدهکار (ریال)",
        "گردش طی دوره - بستانکار (ریال)",
        "گردش مجموع کل - بدهکار (ریال)",
        "گردش مجموع کل - بستانکار (ریال)",
        "مانده پایان دوره - بدهکار (ریال)",
        "مانده پایان دوره - بستانکار (ریال)"
      ]);
    }

    trialBalanceResult.rows.forEach(row => {
      let displayName = row.name;
      if (row.level === 'subsidiary') {
        displayName = "  - " + displayName;
      } else if (row.level === 'detailed') {
        displayName = "    -- " + displayName;
      }

      if (trialBalanceType === '4_column') {
        wsData.push([
          row.code,
          displayName,
          row.turnoverDebit || 0,
          row.turnoverCredit || 0,
          row.endDebit || 0,
          row.endCredit || 0
        ]);
      } else if (trialBalanceType === '6_column') {
        wsData.push([
          row.code,
          displayName,
          row.prevDebit || 0,
          row.prevCredit || 0,
          row.turnoverDebit || 0,
          row.turnoverCredit || 0,
          row.endDebit || 0,
          row.endCredit || 0
        ]);
      } else {
        wsData.push([
          row.code,
          displayName,
          row.prevDebit || 0,
          row.prevCredit || 0,
          row.turnoverDebit || 0,
          row.turnoverCredit || 0,
          row.totalDebit || 0,
          row.totalCredit || 0,
          row.endDebit || 0,
          row.endCredit || 0
        ]);
      }
    });

    wsData.push([]);

    if (trialBalanceType === '4_column') {
      wsData.push([
        "جمع کل",
        "جمع کل ستون‌های تراز شده",
        trialBalanceResult.totals.totalTurnoverDebit,
        trialBalanceResult.totals.totalTurnoverCredit,
        trialBalanceResult.totals.totalEndDebit,
        trialBalanceResult.totals.totalEndCredit
      ]);
    } else if (trialBalanceType === '6_column') {
      wsData.push([
        "جمع کل",
        "جمع کل ستون‌های تراز شده",
        trialBalanceResult.totals.totalPrevDebit,
        trialBalanceResult.totals.totalPrevCredit,
        trialBalanceResult.totals.totalTurnoverDebit,
        trialBalanceResult.totals.totalTurnoverCredit,
        trialBalanceResult.totals.totalEndDebit,
        trialBalanceResult.totals.totalEndCredit
      ]);
    } else {
      wsData.push([
        "جمع کل",
        "جمع کل ستون‌های تراز شده",
        trialBalanceResult.totals.totalPrevDebit,
        trialBalanceResult.totals.totalPrevCredit,
        trialBalanceResult.totals.totalTurnoverDebit,
        trialBalanceResult.totals.totalTurnoverCredit,
        trialBalanceResult.totals.totalCumDebit,
        trialBalanceResult.totals.totalCumCredit,
        trialBalanceResult.totals.totalEndDebit,
        trialBalanceResult.totals.totalEndCredit
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!dir'] = 'rtl';

    XLSX.utils.book_append_sheet(wb, ws, "تراز آزمایشی");
    XLSX.writeFile(wb, `Taraz_Azmayeshi_${startDate.replace(/\//g, '-')}_to_${endDate.replace(/\//g, '-')}.xlsx`);
  };

  if (!trialBalanceResult) return null;

  return (
    <div className="space-y-4 print:space-y-6">
      {/* Printable Header */}
      <div className="hidden print:block text-center space-y-2 border-b pb-4">
        <h2 className="font-sans text-xl font-bold text-black">گزارش تراز آزمایشی پویا</h2>
        <div className="font-sans text-xs text-zinc-600 flex justify-center space-x-6 space-x-reverse">
          <span>دوره گزارش: از {startDate} تا {endDate}</span>
          <span>نوع تراز: {trialBalanceType === '4_column' ? '۴ ستونه' : trialBalanceType === '6_column' ? '۶ ستونه' : '۸ ستونه'}</span>
          <span>سطح حساب‌ها: {trialBalanceLevel === 'general' ? 'حساب‌های کل' : trialBalanceLevel === 'subsidiary' ? 'حساب‌های معین' : 'حساب‌های تفصیلی'}</span>
        </div>
      </div>

      {/* Report Configuration and Action bar (hidden on print) */}
      <div className="print:hidden bg-zinc-50 border border-zinc-150 p-4 rounded-2xl space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="font-sans text-xs font-bold text-zinc-700">تنظیمات تراز آزمایشی:</span>
          
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportExcel}
              className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-sans font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <FileSpreadsheet size={15} />
              خروجی اکسل
            </button>
            
            <button
              onClick={() => window.print()}
              className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-300 px-3 py-1.5 rounded-xl text-xs font-sans font-medium flex items-center gap-1.5 transition-all shadow-sm cursor-pointer"
            >
              <Printer size={15} />
              چاپ / PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-zinc-150">
          <div className="space-y-1.5">
            <span className="block text-right font-sans text-[10px] text-zinc-400">ساختار نمایش ستون‌ها</span>
            <div className="grid grid-cols-3 bg-zinc-200/60 p-1 rounded-xl">
              <button
                onClick={() => setTrialBalanceType('4_column')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceType === '4_column'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                ۴ ستونه
              </button>
              <button
                onClick={() => setTrialBalanceType('6_column')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceType === '6_column'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                ۶ ستونه
              </button>
              <button
                onClick={() => setTrialBalanceType('8_column')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceType === '8_column'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                ۸ ستونه (استاندارد)
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="block text-right font-sans text-[10px] text-zinc-400">سطح حساب‌های گزارش</span>
            <div className="grid grid-cols-3 bg-zinc-200/60 p-1 rounded-xl">
              <button
                onClick={() => setTrialBalanceLevel('general')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceLevel === 'general'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                کل
              </button>
              <button
                onClick={() => setTrialBalanceLevel('subsidiary')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceLevel === 'subsidiary'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                معین
              </button>
              <button
                onClick={() => setTrialBalanceLevel('detailed')}
                className={`font-sans text-xs font-medium py-1.5 rounded-lg transition-all cursor-pointer ${
                  trialBalanceLevel === 'detailed'
                    ? 'bg-white text-zinc-800 shadow-sm font-bold'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                تفصیلی
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Validation Indicator */}
      <div className={`p-3 rounded-2xl border flex items-center justify-between font-sans text-xs shadow-sm ${
        trialBalanceResult.isBalanced 
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <div className="flex items-center gap-1.5">
          <CheckCircle size={16} className={trialBalanceResult.isBalanced ? "text-emerald-600" : "text-amber-600"} />
          <span className="font-bold">
            {trialBalanceResult.isBalanced 
              ? "وضعیت تراز دفتر: تراز ستون‌ها کاملاً برقرار می‌باشد." 
              : "توجه: مجموع اقلام بدهکار و بستانکار در ستون‌ها ناهمخوان است."}
          </span>
        </div>
        <span className="font-mono text-[10px] bg-white px-2 py-0.5 rounded-lg border text-zinc-600">
          {trialBalanceResult.rows.length} حساب فعال
        </span>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-zinc-150 shadow-sm overflow-hidden print:border-0 print:shadow-none">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-right border-collapse text-xs print:text-[10px]">
            <thead>
              <tr className="bg-zinc-100 text-zinc-700 font-sans border-b border-zinc-150 font-bold">
                <th className="p-3 text-center w-24 border-l border-zinc-150">کد حساب</th>
                <th className="p-3 text-right border-l border-zinc-150">نام و شرح حساب</th>
                
                {(trialBalanceType === '6_column' || trialBalanceType === '8_column') && (
                  <th colSpan={2} className="p-2 text-center border-l border-zinc-150 bg-zinc-50/50">گردش ابتدای دوره</th>
                )}
                <th colSpan={2} className="p-2 text-center border-l border-zinc-150">گردش طی دوره</th>
                {trialBalanceType === '8_column' && (
                  <th colSpan={2} className="p-2 text-center border-l border-zinc-150 bg-zinc-50/70">گردش کل / مجموع</th>
                )}
                <th colSpan={2} className="p-2 text-center">مانده نهایی دوره</th>
              </tr>
              <tr className="bg-zinc-50 text-zinc-600 font-sans border-b border-zinc-150">
                <th className="p-1 border-l border-zinc-150"></th>
                <th className="p-1 border-l border-zinc-150"></th>
                {(trialBalanceType === '6_column' || trialBalanceType === '8_column') && (
                  <>
                    <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium">بدهکار (ریال)</th>
                    <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium">بستانکار (ریال)</th>
                  </>
                )}
                <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium">بدهکار (ریال)</th>
                <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium">بستانکار (ریال)</th>
                {trialBalanceType === '8_column' && (
                  <>
                    <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium bg-zinc-50/70">بدهکار (ریال)</th>
                    <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium bg-zinc-50/70">بستانکار (ریال)</th>
                  </>
                )}
                <th className="p-2 text-center w-24 border-l border-zinc-150 font-medium">بدهکار (ریال)</th>
                <th className="p-2 text-center w-24 font-medium">بستانکار (ریال)</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-100 font-mono text-zinc-800">
              {trialBalanceResult.rows.map((row, idx) => {
                const isGeneral = row.level === 'general';
                const isSub = row.level === 'subsidiary';
                const isDet = row.level === 'detailed';

                let bgClass = "bg-white hover:bg-zinc-50/50";
                if (isGeneral) bgClass = "bg-zinc-50/70 font-bold text-zinc-950";
                
                return (
                  <tr key={idx} className={`${bgClass} transition-colors`}>
                    <td className={`p-2.5 text-center border-l border-zinc-100 ${
                      isGeneral ? "font-bold text-emerald-800" : isDet ? "text-zinc-500 text-[10px]" : ""
                    }`}>
                      {row.code}
                    </td>

                    <td className={`p-2.5 text-right border-l border-zinc-100 font-sans ${
                      isGeneral ? "font-bold text-zinc-900" : isSub ? "pr-5 text-zinc-800" : "pr-10 text-zinc-500 text-[11px]"
                    }`}>
                      <div className="flex items-center gap-1.5">
                        {isGeneral && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        {isSub && <span className="w-1 h-1 rounded-full bg-zinc-400" />}
                        {isDet && <span className="w-1 h-0.5 bg-zinc-300" />}
                        <span>{row.name}</span>
                        {isGeneral && <span className="text-[9px] text-zinc-400 font-normal mr-1">(کل)</span>}
                        {isSub && <span className="text-[9px] text-zinc-400 font-normal mr-1">(معین)</span>}
                        {isDet && <span className="text-[8px] text-zinc-400 font-normal mr-1">(تفصیلی)</span>}
                      </div>
                    </td>

                    {(trialBalanceType === '6_column' || trialBalanceType === '8_column') && (
                      <>
                        <td className="p-2.5 text-center border-l border-zinc-100 text-zinc-700 bg-zinc-50/20">
                          {row.prevDebit > 0 ? row.prevDebit.toLocaleString() : "-"}
                        </td>
                        <td className="p-2.5 text-center border-l border-zinc-100 text-zinc-700 bg-zinc-50/20">
                          {row.prevCredit > 0 ? row.prevCredit.toLocaleString() : "-"}
                        </td>
                      </>
                    )}

                    <td className="p-2.5 text-center border-l border-zinc-100">
                      {row.turnoverDebit > 0 ? row.turnoverDebit.toLocaleString() : "-"}
                    </td>
                    <td className="p-2.5 text-center border-l border-zinc-100">
                      {row.turnoverCredit > 0 ? row.turnoverCredit.toLocaleString() : "-"}
                    </td>

                    {trialBalanceType === '8_column' && (
                      <>
                        <td className="p-2.5 text-center border-l border-zinc-100 text-zinc-900 bg-zinc-50/50">
                          {row.totalDebit > 0 ? row.totalDebit.toLocaleString() : "-"}
                        </td>
                        <td className="p-2.5 text-center border-l border-zinc-100 text-zinc-900 bg-zinc-50/50">
                          {row.totalCredit > 0 ? row.totalCredit.toLocaleString() : "-"}
                        </td>
                      </>
                    )}

                    <td className={`p-2.5 text-center border-l border-zinc-100 ${isGeneral ? "text-emerald-800" : "text-zinc-900"}`}>
                      {row.endDebit > 0 ? row.endDebit.toLocaleString() : "-"}
                    </td>
                    <td className={`p-2.5 text-center ${isGeneral ? "text-emerald-800" : "text-zinc-900"}`}>
                      {row.endCredit > 0 ? row.endCredit.toLocaleString() : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="bg-zinc-100 text-zinc-900 font-bold border-t border-zinc-200">
                <td className="p-3 text-center border-l border-zinc-150">جمع کل</td>
                <td className="p-3 text-right font-sans border-l border-zinc-150">جمع کل ستون‌های تراز شده</td>
                
                {(trialBalanceType === '6_column' || trialBalanceType === '8_column') && (
                  <>
                    <td className="p-3 text-center border-l border-zinc-150 text-zinc-950">
                      {trialBalanceResult.totals.totalPrevDebit.toLocaleString()}
                    </td>
                    <td className="p-3 text-center border-l border-zinc-150 text-zinc-950">
                      {trialBalanceResult.totals.totalPrevCredit.toLocaleString()}
                    </td>
                  </>
                )}

                <td className="p-3 text-center border-l border-zinc-150 text-zinc-950">
                  {trialBalanceResult.totals.totalTurnoverDebit.toLocaleString()}
                </td>
                <td className="p-3 text-center border-l border-zinc-150 text-zinc-950">
                  {trialBalanceResult.totals.totalTurnoverCredit.toLocaleString()}
                </td>

                {trialBalanceType === '8_column' && (
                  <>
                    <td className="p-3 text-center border-l border-zinc-150 text-zinc-950 bg-zinc-200/50">
                      {trialBalanceResult.totals.totalCumDebit.toLocaleString()}
                    </td>
                    <td className="p-3 text-center border-l border-zinc-150 text-zinc-950 bg-zinc-200/50">
                      {trialBalanceResult.totals.totalCumCredit.toLocaleString()}
                    </td>
                  </>
                )}

                <td className="p-3 text-center border-l border-zinc-150 text-zinc-950">
                  {trialBalanceResult.totals.totalEndDebit.toLocaleString()}
                </td>
                <td className="p-3 text-center text-zinc-950">
                  {trialBalanceResult.totals.totalEndCredit.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
