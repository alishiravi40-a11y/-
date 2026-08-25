import fs from 'fs';
let code = fs.readFileSync('src/components/CheckSettlementCalculator.tsx', 'utf8');
code = code.replace(
  "return isNaN(val) || val === 0 ? '' : val;",
  "return isNaN(val) ? 0 : val;"
);
code = code.replace(
  "if (!isNaN(val) && val > 0) {",
  "if (!isNaN(val)) {"
);
code = code.replace(
  "type=\"number\"",
  "type=\"text\""
);
code = code.replace(
  "value={amount}",
  "value={amount ? Number(amount).toLocaleString() : ''}"
);
code = code.replace(
  "onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}",
  "onChange={(e) => setAmount(parseNumericValue(e.target.value))}"
);
fs.writeFileSync('src/components/CheckSettlementCalculator.tsx', code);
