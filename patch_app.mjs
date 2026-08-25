import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "AppState, Person, Product, Check, Invoice, JournalVoucher, ReceivedCheckState, PaidCheckState, BouncedReceivedCheckSubState, BouncedPaidCheckSubState, AccountSubsidiary, OpeningBalance, Warehouse, CostCenter, WarehouseTransfer, BankTerminal, User, CriticalDetails } from './types';",
  "AppState, Person, Product, Check, Invoice, JournalVoucher, VoucherEntry, ReceivedCheckState, PaidCheckState, BouncedReceivedCheckSubState, BouncedPaidCheckSubState, AccountSubsidiary, OpeningBalance, Warehouse, CostCenter, WarehouseTransfer, BankTerminal, User, CriticalDetails } from './types';"
);
fs.writeFileSync('src/App.tsx', code);
