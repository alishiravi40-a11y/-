import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "      bankName: checkBank,\n      accountNumber: '',\n      checkNumber: checkNo,",
  "      bankName: checkBank,\n      checkNumber: checkNo,"
);
fs.writeFileSync('src/App.tsx', code);
