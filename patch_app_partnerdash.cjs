const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const target = `          <PartnerDashboard 
            state={state} 
            currentUserId={currentUserId}
            currentAgentId={currentAgentId}
            onLogout={() => {
              setIsLoggedIn(false);
              setCurrentUserRole(null);
            }}
          />`;

const replacement = `          <PartnerDashboard 
            state={state} 
            currentUserId={currentUserId}
            currentAgentId={currentAgentId}
            onLogout={() => {
              setIsLoggedIn(false);
              setCurrentUserRole(null);
            }}
            onAddCustomer={(personData) => {
              const nextCode = \`P\${1000 + state.persons.length + 1}\`;
              const newPerson: Person = {
                id: \`p_\${Date.now()}\`,
                code: nextCode,
                name: personData.name || '',
                mobile: personData.mobile,
                phone: personData.phone,
                nationalId: personData.nationalId,
                address: personData.address,
                role: 'debtor',
                createdAt: new Date().toISOString(),
                createdBy: currentUserId,
                representativeId: currentAgentId
              };
              setState(prev => {
                const updated = { ...prev, persons: [...prev.persons, newPerson] };
                saveAppState(updated);
                return updated;
              });
            }}
          />`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
