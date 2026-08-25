const fs = require('fs');
let code = fs.readFileSync('src/components/PartnerDashboard.tsx', 'utf-8');

const target = `  const customers = useMemo(() => {
    if (!currentPartner) return [];
    const customerIds = Array.from(new Set(partnerRequests.map(r => r.customerPersonId)));
    return state.persons.filter(p => customerIds.includes(p.id));
  }, [partnerRequests, state.persons]);`;

const replacement = `  const customers = useMemo(() => {
    if (!currentPartner) return [];
    const customerIds = Array.from(new Set(partnerRequests.map(r => r.customerPersonId)));
    return state.persons.filter(p => 
      customerIds.includes(p.id) || 
      p.representativeId === currentAgentId ||
      p.createdBy === currentUserId
    );
  }, [partnerRequests, state.persons, currentAgentId, currentUserId]);`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/PartnerDashboard.tsx', code);
