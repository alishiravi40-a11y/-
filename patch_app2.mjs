import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "      bankName: checkBank,\n      branchName: '',\n      accountNumber: '',",
  "      bankName: checkBank,\n      accountNumber: '',"
);
fs.writeFileSync('src/App.tsx', code);
