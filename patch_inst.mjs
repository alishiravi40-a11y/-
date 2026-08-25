import fs from 'fs';
let code = fs.readFileSync('src/components/InstallmentBookletManager.tsx', 'utf8');
code = code.replace(
  "AppState, InstallmentBook, Installment, Person, Invoice } from '../types';",
  "AppState, InstallmentBook, Installment, Person, Invoice, JournalVoucher, VoucherEntry } from '../types';"
);
fs.writeFileSync('src/components/InstallmentBookletManager.tsx', code);
