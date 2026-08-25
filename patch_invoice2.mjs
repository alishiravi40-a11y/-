import fs from 'fs';
let code = fs.readFileSync('src/components/InvoiceForm.tsx', 'utf8');

code = code.replace(
  "value={cashPaidAmount ? cashPaidAmount.toLocaleString() : 0}",
  "value={cashPaidAmount === 0 ? 0 : (cashPaidAmount || 0).toLocaleString()}"
);
code = code.replace(
  "value={posPaidAmount ? posPaidAmount.toLocaleString() : 0}",
  "value={posPaidAmount === 0 ? 0 : (posPaidAmount || 0).toLocaleString()}"
);

fs.writeFileSync('src/components/InvoiceForm.tsx', code);
