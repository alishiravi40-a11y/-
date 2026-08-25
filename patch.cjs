const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const target = `  const [state, setState] = useState<AppState>({
    users: [],`;

const replacement = `  const [state, setState] = useState<AppState>(() => {
    const initialState: AppState = {
      users: [],`;

const targetEnd = `    }
  });

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');`;

const replacementEnd = `    }
    };
    
    const loaded = loadAppState();
    return {
      ...initialState,
      ...loaded,
      businessPartners: loaded.businessPartners || initialState.businessPartners,
      partnerCreditRequests: loaded.partnerCreditRequests || initialState.partnerCreditRequests,
      partnerSalesPlans: loaded.partnerSalesPlans || initialState.partnerSalesPlans
    };
  });

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');`;

code = code.replace(target, replacement).replace(targetEnd, replacementEnd);
fs.writeFileSync('src/App.tsx', code);
