const fs = require('fs');
let code = fs.readFileSync('src/components/AgentManager.tsx', 'utf-8');

code = code.replace(
  "            riskLevel: 'medium',",
  "            riskLevel: 'medium' as any,"
);

fs.writeFileSync('src/components/AgentManager.tsx', code);
