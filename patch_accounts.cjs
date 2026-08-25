const fs = require('fs');
let code = fs.readFileSync('src/components/AccountsManager.tsx', 'utf8');

if (!code.includes('onViewVoucher?: (voucherId: string) => void;')) {
  code = code.replace("onNavigate?: (tab: string) => void;", 
  "onNavigate?: (tab: string) => void;\n  onViewVoucher?: (voucherId: string) => void;\n  onViewCheck?: (checkId: string) => void;");
}

if (!code.includes('onViewCheck={onViewCheck}')) {
  code = code.replace("<SubsidiaryLedgerModal", "<SubsidiaryLedgerModal\n          onViewVoucher={onViewVoucher}\n          onViewCheck={onViewCheck}");
}

fs.writeFileSync('src/components/AccountsManager.tsx', code);
