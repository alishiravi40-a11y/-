const fs = require('fs');
let code = fs.readFileSync('src/components/PartnerDashboard.tsx', 'utf-8');

code = code.replace(
  "  const [selectedBranchId, setSelectedBranchId] = useState('');",
  "  const [selectedBranchId, setSelectedBranchId] = useState('');\n  const [isAddingCustomer, setIsAddingCustomer] = useState(false);"
);

fs.writeFileSync('src/components/PartnerDashboard.tsx', code);
