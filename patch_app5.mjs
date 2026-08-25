import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "      status: 'present_in_cashbox',\n      history:",
  "      currentState: 'present_in_cashbox',\n      history:"
);
fs.writeFileSync('src/App.tsx', code);
