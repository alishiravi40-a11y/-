import fs from 'fs';
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "      isInstallment: true\n    };",
  "      isInstallment: true,\n      createdAt: new Date().toISOString()\n    };"
);
fs.writeFileSync('src/App.tsx', code);
