import fs from 'fs';
let code = fs.readFileSync('src/components/InstallmentBookletManager.tsx', 'utf8');
code = code.replace(
  "status: 'paid',",
  "status: 'paid' as const,"
);
fs.writeFileSync('src/components/InstallmentBookletManager.tsx', code);
