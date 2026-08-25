const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Import CheckDetailModal
if (!code.includes('CheckDetailModal')) {
  code = code.replace("import VoucherDetailModal from './components/VoucherDetailModal';", 
  "import VoucherDetailModal from './components/VoucherDetailModal';\nimport CheckDetailModal from './components/CheckDetailModal';");
}

// Add state
if (!code.includes('selectedCheckForView')) {
  code = code.replace("const [selectedVoucherForView, setSelectedVoucherForView] = useState<JournalVoucher | undefined>(undefined);",
  "const [selectedVoucherForView, setSelectedVoucherForView] = useState<JournalVoucher | undefined>(undefined);\n  const [selectedCheckForView, setSelectedCheckForView] = useState<Check | undefined>(undefined);");
}

// Pass onViewCheck to ReportsView
code = code.replace(/<ReportsView\s+state=\{state\}/, "<ReportsView \n                state={state} \n                onViewCheck={(checkId) => setSelectedCheckForView(state.checks.find(c => c.id === checkId))}");

// Pass onViewCheck & onViewVoucher to AccountsManager
code = code.replace(/<AccountsManager\s+state=\{state\}/, "<AccountsManager \n                state={state}\n                onViewVoucher={(voucherId) => setSelectedVoucherForView(state.vouchers.find(v => v.id === voucherId))}\n                onViewCheck={(checkId) => setSelectedCheckForView(state.checks.find(c => c.id === checkId))}");

// Render CheckDetailModal
if (!code.includes('<CheckDetailModal')) {
  const modalRender = `
        {selectedCheckForView && (
          <CheckDetailModal
            check={selectedCheckForView}
            appState={state}
            onClose={() => setSelectedCheckForView(undefined)}
            onViewVoucher={(voucherId) => {
              setSelectedCheckForView(undefined);
              setSelectedVoucherForView(state.vouchers.find(v => v.id === voucherId));
            }}
          />
        )}
  `;
  code = code.replace("{selectedVoucherForView && (", modalRender + "\n        {selectedVoucherForView && (");
}

fs.writeFileSync('src/App.tsx', code);
