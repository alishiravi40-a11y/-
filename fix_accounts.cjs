const fs = require('fs');
let code = fs.readFileSync('src/components/AccountsManager.tsx', 'utf8');

code = code.replace(
  "export default function AccountsManager({ \n  state, \n  onAddSubsidiary, ",
  "export default function AccountsManager({ \n  state, \n  onAddSubsidiary, \n  onViewVoucher,\n  onViewCheck,\n"
);

// If the regex replacement didn't match perfectly, let's try a broader one:
if (!code.includes('onViewVoucher,')) {
  code = code.replace(
    "export default function AccountsManager({ \n  state, \n  onAddSubsidiary, \n  onEditSubsidiary,",
    "export default function AccountsManager({ \n  state, \n  onAddSubsidiary, \n  onEditSubsidiary, \n  onViewVoucher,\n  onViewCheck,"
  );
}

fs.writeFileSync('src/components/AccountsManager.tsx', code);
