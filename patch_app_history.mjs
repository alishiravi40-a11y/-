import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
`        {
          id: \`h_\${Date.now()}\`,
          date: jalaliDate,
          gregorianDate: new Date().toISOString(),
          fromStatus: 'none',
          toStatus: 'present_in_cashbox',
          description: \`دریافت چک بابت تسویه بدهی اقساطی\`
        }`,
`        {
          state: 'present_in_cashbox',
          date: jalaliDate,
          note: \`دریافت چک بابت تسویه بدهی اقساطی\`
        }`
);
fs.writeFileSync('src/App.tsx', code);
