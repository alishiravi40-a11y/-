import fs from 'fs';
let code = fs.readFileSync('src/components/InvoiceForm.tsx', 'utf8');

code = code.replace(
  "subtotal += item.quantity * item.unitPrice;",
  "subtotal += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);"
);
code = code.replace(
  "rowDiscounts += item.discount;",
  "rowDiscounts += (Number(item.discount) || 0);"
);
code = code.replace(
  "const netAmount = subtotal - rowDiscounts - discount;",
  "const netAmount = subtotal - rowDiscounts - (Number(discount) || 0);"
);
code = code.replace(
  "const vatAmount = Math.round(netAmount * (taxPercent / 100));",
  "const vatAmount = Math.round(netAmount * ((Number(taxPercent) || 0) / 100));"
);

fs.writeFileSync('src/components/InvoiceForm.tsx', code);
