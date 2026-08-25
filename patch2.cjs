const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const target = `        return { ...prev, users: updatedUsers, businessPartners: updatedBPs };
      });

      // 3. Finalize Login State`;

const replacement = `        const newState = { ...prev, users: updatedUsers, businessPartners: updatedBPs };
        saveAppState(newState);
        return newState;
      });

      // 3. Finalize Login State`;

code = code.replace(target, replacement);
fs.writeFileSync('src/App.tsx', code);
