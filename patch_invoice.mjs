import fs from 'fs';
let code = fs.readFileSync('src/components/InvoiceForm.tsx', 'utf8');
code = code.replace(
  "const newInvoiceCreditPart = totals.finalAmount - (cashPaidAmount + posPaidAmount);",
  "const newInvoiceCreditPart = totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0));"
);
code = code.replace(
  "const invoiceRemainingToPay = isPaidFromWallet ? 0 : (finalTotal - (cashPaidAmount + posPaidAmount));",
  "const invoiceRemainingToPay = isPaidFromWallet ? 0 : (finalTotal - ((cashPaidAmount || 0) + (posPaidAmount || 0)));"
);
code = code.replace(
  "totals.finalAmount - (cashPaidAmount + posPaidAmount)",
  "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))"
);
code = code.replace(
  "totals.finalAmount - (cashPaidAmount + posPaidAmount)",
  "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))"
);
code = code.replace(
  "totals.finalAmount - (cashPaidAmount + posPaidAmount)",
  "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))"
);
code = code.replace(
  "totals.finalAmount - (cashPaidAmount + posPaidAmount)",
  "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))"
);
code = code.replace(
  "value={cashPaidAmount > 0 ? cashPaidAmount.toLocaleString() : ''}",
  "value={cashPaidAmount ? cashPaidAmount.toLocaleString() : 0}"
);
code = code.replace(
  "value={posPaidAmount > 0 ? posPaidAmount.toLocaleString() : ''}",
  "value={posPaidAmount ? posPaidAmount.toLocaleString() : 0}"
);
fs.writeFileSync('src/components/InvoiceForm.tsx', code);
