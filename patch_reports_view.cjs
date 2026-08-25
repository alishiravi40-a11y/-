const fs = require('fs');
let code = fs.readFileSync('src/components/ReportsView.tsx', 'utf8');

// Add onViewCheck prop
if (!code.includes('onViewCheck?: (checkId: string) => void;')) {
  code = code.replace("onViewVoucher?: (voucherId: string) => void;", "onViewVoucher?: (voucherId: string) => void;\n  onViewCheck?: (checkId: string) => void;");
}

code = code.replace(
  "onDeleteVoucher,\n  onOpenAdvancedSearch\n}: ReportsViewProps) {",
  "onDeleteVoucher,\n  onOpenAdvancedSearch,\n  onViewCheck\n}: ReportsViewProps) {"
);

// Fix generalSubsidiaryResult compiler
code = code.replace(
  "floatingName?: string;\n      voucherId?: string;\n    }[] = [];",
  "floatingName?: string;\n      voucherId?: string;\n      sourceType?: string;\n      sourceId?: string;\n    }[] = [];"
);

code = code.replace(
  "floatingName: e.floatingDetailed?.name,\n              voucherId: v.id\n            });",
  "floatingName: e.floatingDetailed?.name,\n              voucherId: v.id,\n              sourceType: v.sourceType,\n              sourceId: v.sourceId\n            });"
);

// Fix person_ledger onClick
const personLedgerOnClick = `onClick={() => {
                          if (ent.sourceType === 'check_state_change' && ent.sourceId && onViewCheck) {
                            onViewCheck(ent.sourceId);
                            return;
                          }
                          if (ent.voucherId && onViewVoucher) {
                            onViewVoucher(ent.voucherId);
                          }
                        }}`;

code = code.replace(
  /onClick=\{\(\) => \{\s*if \(ent\.sourceType === 'check_state_change' && ent\.sourceId\) \{[\s\S]*?if \(ent\.voucherId && onViewVoucher\) \{\s*onViewVoucher\(ent\.voucherId\);\s*\}\s*\}\}/,
  personLedgerOnClick
);

// Fix general_subsidiary_ledger onClick
const generalLedgerOnClick = `onClick={() => {
                        if (ent.sourceType === 'check_state_change' && ent.sourceId && onViewCheck) {
                          onViewCheck(ent.sourceId);
                          return;
                        }
                        if (ent.voucherId && onViewVoucher) {
                          onViewVoucher(ent.voucherId);
                        }
                      }}`;

code = code.replace(
  /onClick=\{\(\) => ent\.voucherId && onViewVoucher && onViewVoucher\(ent\.voucherId\)\}/,
  generalLedgerOnClick
);

fs.writeFileSync('src/components/ReportsView.tsx', code);
