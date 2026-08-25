const fs = require('fs');
let code = fs.readFileSync('src/components/PartnerDashboard.tsx', 'utf-8');

code = code.replace(
  "  onLogout: () => void;\n}",
  "  onLogout: () => void;\n  onAddCustomer: (personData: Partial<Person>) => void;\n}"
);

code = code.replace(
  "export default function PartnerDashboard({ state, currentUserId, currentAgentId, onLogout }: PartnerDashboardProps) {",
  "import PersonForm from './PersonForm';\n\nexport default function PartnerDashboard({ state, currentUserId, currentAgentId, onLogout, onAddCustomer }: PartnerDashboardProps) {"
);

fs.writeFileSync('src/components/PartnerDashboard.tsx', code);
