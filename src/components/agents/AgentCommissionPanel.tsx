import React from 'react';
import { AppState, Check as CheckTypeModel } from '../../types';

interface AgentCommissionPanelProps {
  appState: AppState;
  pendingChecks: CheckTypeModel[];
  selectedCheckId: string | null;
  commissionAmount: number;
  netAmount: number;
  onSelectCheck: (checkId: string | null, amount: number) => void;
  onChangeCommission: (commission: number, net: number) => void;
  onChangeNet: (net: number, commission: number) => void;
  onApproveCheck: (checkId: string) => void;
}

export const AgentCommissionPanel: React.FC<AgentCommissionPanelProps> = ({
  appState,
  pendingChecks,
  selectedCheckId,
  commissionAmount,
  netAmount,
  onSelectCheck,
  onChangeCommission,
  onChangeNet,
  onApproveCheck,
}) => {
  return (
    <div className="space-y-3">
      {pendingChecks.length === 0 && (
        <div className="text-center text-zinc-400 text-[13px] py-10 bg-white border rounded-2xl">
          چک جدیدی از طرف همکاران برای تایید و صدور اعتبار وجود ندارد
        </div>
      )}

      {pendingChecks.map(check => {
        const agent = appState.persons.find(p => p.id === check.submittedByAgentId);
        const isSelected = selectedCheckId === check.id;

        return (
          <div
            key={check.id}
            className={`bg-white rounded-2xl border transition-all ${
              isSelected ? 'border-emerald-500 ring-4 ring-emerald-50' : 'border-zinc-150'
            }`}
          >
            <div
              className="p-4 cursor-pointer flex justify-between items-start"
              onClick={() => {
                if (isSelected) {
                  onSelectCheck(null, 0);
                } else {
                  onSelectCheck(check.id, check.amount);
                }
              }}
            >
              <div>
                <div className="font-mono font-bold text-emerald-600 text-sm">
                  {check.amount.toLocaleString()} ریال
                </div>
                <div className="text-[13px] font-bold text-zinc-800 mt-1">بانک {check.bankName}</div>
                <div className="text-xs text-zinc-600 mt-0.5">
                  کد ملی صادرکننده: <span className="font-mono">{check.nationalId || 'نامشخص'}</span>
                </div>
                <div className="text-[10px] text-zinc-400 mt-2">
                  ثبت شده توسط همکار: <strong className="text-zinc-600">{agent?.name}</strong>
                </div>
              </div>
              <div className="text-left">
                <div className="text-xs text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded-md font-mono">
                  تاریخ سررسید: {check.dueDate}
                </div>
              </div>
            </div>

            {isSelected && (
              <div className="border-t border-emerald-100 p-4 bg-emerald-50/20 rounded-b-2xl space-y-3">
                <div>
                  <label className="block text-xs text-zinc-600 font-bold mb-1">
                    کارمزد مجموعه (ریال)
                  </label>
                  <input
                    type="number"
                    value={commissionAmount || ''}
                    onChange={e => {
                      const val = parseInt(e.target.value || '0', 10);
                      onChangeCommission(val, check.amount - val);
                    }}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 font-mono text-[13px] outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-600 font-bold mb-1">
                    خالص واریزی اعتباری به همکار (ریال)
                  </label>
                  <input
                    type="number"
                    value={netAmount || ''}
                    onChange={e => {
                      const val = parseInt(e.target.value || '0', 10);
                      onChangeNet(val, check.amount - val);
                    }}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-3 py-2 font-mono text-[13px] outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  onClick={() => onApproveCheck(check.id)}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-sans text-[13px] font-bold py-2.5 rounded-xl shadow transition mt-2 cursor-pointer"
                >
                  تایید چک، کسر کارمزد و صدور سند دوبل اعتباری
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AgentCommissionPanel;
