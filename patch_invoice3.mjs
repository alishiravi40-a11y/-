import fs from 'fs';
let code = fs.readFileSync('src/components/InvoiceForm.tsx', 'utf8');

// Ensure COALESCE-like behavior using Number() || 0
code = code.replace(
  "const newInvoiceCreditPart = totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0));",
  "const newInvoiceCreditPart = (Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0));"
);
code = code.replace(
  "const invoiceRemainingToPay = isPaidFromWallet ? 0 : (finalTotal - ((cashPaidAmount || 0) + (posPaidAmount || 0)));",
  "const invoiceRemainingToPay = isPaidFromWallet ? 0 : ((Number(finalTotal) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0)));"
);

// We have 4 occurrences of "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))" that need to be made more robust
code = code.replaceAll(
  "totals.finalAmount - ((cashPaidAmount || 0) + (posPaidAmount || 0))",
  "(Number(totals.finalAmount) || 0) - ((Number(cashPaidAmount) || 0) + (Number(posPaidAmount) || 0))"
);

// Let's also do it for totals finalAmount rendering
code = code.replaceAll(
  "totals.finalAmount.toLocaleString()",
  "(Number(totals.finalAmount) || 0).toLocaleString()"
);

// Fix the inputs to always show 0 when 0
code = code.replace(
  "value={cashPaidAmount === 0 ? 0 : (cashPaidAmount || 0).toLocaleString()}",
  "value={cashPaidAmount === 0 ? '0' : (Number(cashPaidAmount) || 0).toLocaleString()}"
);
code = code.replace(
  "value={posPaidAmount === 0 ? 0 : (posPaidAmount || 0).toLocaleString()}",
  "value={posPaidAmount === 0 ? '0' : (Number(posPaidAmount) || 0).toLocaleString()}"
);

// Make sure initial state defaults to 0 safely
code = code.replace(
  "useState<number>(initialInvoice?.cashPaidAmount || 0)",
  "useState<number>(Number(initialInvoice?.cashPaidAmount) || 0)"
);
code = code.replace(
  "useState<number>(initialInvoice?.posPaidAmount || 0)",
  "useState<number>(Number(initialInvoice?.posPaidAmount) || 0)"
);
code = code.replace(
  "setCashPaidAmount(initialInvoice.cashPaidAmount || 0)",
  "setCashPaidAmount(Number(initialInvoice.cashPaidAmount) || 0)"
);
code = code.replace(
  "setPosPaidAmount(initialInvoice.posPaidAmount || 0)",
  "setPosPaidAmount(Number(initialInvoice.posPaidAmount) || 0)"
);

fs.writeFileSync('src/components/InvoiceForm.tsx', code);
