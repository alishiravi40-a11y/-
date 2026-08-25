const fs = require('fs');
let code = fs.readFileSync('src/components/SubsidiaryLedgerModal.tsx', 'utf8');

if (!code.includes('onViewVoucher?: (voucherId: string) => void;')) {
  code = code.replace("onNewVoucher: () => void;", 
  "onNewVoucher: () => void;\n  onViewVoucher?: (voucherId: string) => void;\n  onViewCheck?: (checkId: string) => void;");
}

code = code.replace(
  "export default function SubsidiaryLedgerModal({ subsidiary, state, onClose, onEditVoucher, onDeleteVoucher, onNewVoucher }: SubsidiaryLedgerModalProps) {",
  "export default function SubsidiaryLedgerModal({ subsidiary, state, onClose, onEditVoucher, onDeleteVoucher, onNewVoucher, onViewVoucher, onViewCheck }: SubsidiaryLedgerModalProps) {"
);

// We should update the tr to be clickable, OR add an Eye icon button.
if (!code.includes('onViewVoucher(e.voucher.id)')) {
  // Add a view button before the edit button
  code = code.replace(
    "<button \n                            onClick={() => onEditVoucher(e.voucher)}",
    `{onViewVoucher && (
                            <button 
                              onClick={(event) => {
                                event.stopPropagation();
                                if (e.voucher.sourceType === 'check_state_change' && e.voucher.sourceId && onViewCheck) {
                                  onViewCheck(e.voucher.sourceId);
                                } else {
                                  onViewVoucher(e.voucher.id);
                                }
                              }}
                              className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                              title="مشاهده منبع / جزئیات"
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          <button \n                            onClick={() => onEditVoucher(e.voucher)}`
  );
}

fs.writeFileSync('src/components/SubsidiaryLedgerModal.tsx', code);
