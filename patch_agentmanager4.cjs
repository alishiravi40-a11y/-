const fs = require('fs');
let code = fs.readFileSync('src/components/AgentManager.tsx', 'utf-8');

code = code.replace(
  "        personId: partnerId,\n        status: isNowApproved ? ('active' as const) : ('pending' as const),\n        roles: ['CREDIT_SALES_AGENT' as any],",
  "        personId: partnerId,\n        status: isNowApproved ? ('active' as const) : ('pending' as const),\n        agencyType: 'CREDIT_ONLY' as any,\n        roles: ['CREDIT_SALES_AGENT' as any],"
);

fs.writeFileSync('src/components/AgentManager.tsx', code);
