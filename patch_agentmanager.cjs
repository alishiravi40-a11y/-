const fs = require('fs');
let code = fs.readFileSync('src/components/AgentManager.tsx', 'utf-8');

code = code.replace(
  "          status: 'pending',\n          agencyType: agencyType,\n          roles: ['CREDIT_SALES_AGENT'],",
  "          status: 'pending' as const,\n          agencyType: agencyType as any,\n          roles: ['CREDIT_SALES_AGENT'] as any,"
);

code = code.replace(
  "            status: 'active',\n            roles: [\"CREDIT_SALES_AGENT\"],",
  "            status: 'active' as const,\n            agencyType: 'CREDIT_ONLY' as any,\n            roles: [\"CREDIT_SALES_AGENT\"] as any,"
);

fs.writeFileSync('src/components/AgentManager.tsx', code);
