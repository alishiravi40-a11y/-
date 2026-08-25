const fs = require('fs');
let code = fs.readFileSync('src/components/AgentManager.tsx', 'utf-8');

code = code.replace(
  "          status: isNowApproved ? ('active' as const) : ('suspended' as const),",
  "          status: isNowApproved ? ('active' as const) : ('suspended' as const),\n          agencyType: 'CREDIT_ONLY' as any,"
);

code = code.replace(
  "            riskLevel: 'normal',",
  "            riskLevel: 'medium',"
);

code = code.replace(
  "          status: 'pending',\n          roles: ['CREDIT_SALES_AGENT'],",
  "          status: 'pending' as const,\n          agencyType: 'CREDIT_ONLY' as any,\n          roles: ['CREDIT_SALES_AGENT'] as any,"
);


fs.writeFileSync('src/components/AgentManager.tsx', code);
