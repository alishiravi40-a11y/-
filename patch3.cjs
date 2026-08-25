const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace("id: 'BP_DEMO_1',", "id: 'BP_DEMO_1',\n        agencyType: 'credit',");

fs.writeFileSync('src/App.tsx', code);
