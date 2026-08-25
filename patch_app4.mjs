import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "      dueDate,\n      sayyadId,\n      status: 'present_in_cashbox',",
  "      dueDate,\n      sayadiNumber: sayyadId,\n      status: 'present_in_cashbox',"
);
fs.writeFileSync('src/App.tsx', code);
