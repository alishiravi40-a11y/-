const fs = require('fs');
let code = fs.readFileSync('src/components/AgentManager.tsx', 'utf-8');

code = code.replace(
  "          status: isNowApproved ? ('active' as const) : ('suspended' as const),\n          agencyType: 'CREDIT_ONLY' as any,",
  "          status: isNowApproved ? ('active' as const) : ('suspended' as const),"
);

code = code.replace(
  "          id: newBpId,\n          personId: agentId,\n          status: isNowApproved ? ('active' as const) : ('pending' as const),",
  "          id: newBpId,\n          personId: agentId,\n          status: isNowApproved ? ('active' as const) : ('pending' as const),\n          agencyType: 'CREDIT_ONLY' as any,"
);

fs.writeFileSync('src/components/AgentManager.tsx', code);
