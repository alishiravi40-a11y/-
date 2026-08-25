const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace the first occurrence of the debtor form
const debtorFormStart = `                    <div className="bg-white p-4 rounded-3xl border border-zinc-150 shadow-sm relative">
                      <div className="flex justify-between items-center border-b border-zinc-100 pb-2 mb-3">`;
const debtorFormRegex = /<div className="bg-white p-4 rounded-3xl border border-zinc-150 shadow-sm relative">[\s\S]*?<span>\{editingPerson \? 'ذخیره تغییرات' : 'ثبت شخص جدید'\}<\/span>\s*<\/button>\s*<\/form>\s*<\/div>/g;

let matches = [...code.matchAll(debtorFormRegex)];
if (matches.length >= 2) {
  // First match is debtor
  code = code.replace(matches[0][0], `
                    <PersonForm
                      initialPerson={editingPerson}
                      isDebtor={true}
                      onSave={(personData, registerAmani) => handleAddPersonFromComponent(personData, registerAmani, true)}
                      onCancel={() => { setIsAddingDebtor(false); setEditingPerson(null); }}
                    />`);
  // Second match is creditor
  code = code.replace(matches[1][0], `
                    <PersonForm
                      initialPerson={editingPerson}
                      isCreditor={true}
                      onSave={(personData, registerAmani) => handleAddPersonFromComponent(personData, registerAmani, false)}
                      onCancel={() => { setIsAddingCreditor(false); setEditingPerson(null); }}
                    />`);
}

// Now we need to add the import and the handleAddPersonFromComponent function
if (!code.includes("import PersonForm")) {
  code = code.replace("import InvoiceForm", "import PersonForm from './components/PersonForm';\nimport InvoiceForm");
}

const addPersonFn = `  // Add or Edit Person manually
  const handleAddPersonFromComponent = (personData: Partial<Person>, registerAmaniCheck: boolean, isDebtorRole: boolean) => {
    if (editingPerson) {
      setState(prev => {
        const updatedPersons = prev.persons.map(p => {
          if (p.id === editingPerson.id) {
            return {
              ...p,
              ...personData
            };
          }
          return p;
        });
        const updated = { ...prev, persons: updatedPersons };
        saveAppState(updated);
        return updated;
      });
      setEditingPerson(null);
    } else {
      const nextCode = \`P\${1000 + state.persons.length + 1}\`;
      const newPerson: Person = {
        id: \`p_\${Date.now()}\`,
        code: nextCode,
        name: personData.name || '',
        mobile: personData.mobile,
        phone: personData.phone,
        nationalId: personData.nationalId,
        address: personData.address,
        role: isDebtorRole ? 'debtor' : (!isDebtorRole && isAddingCreditor ? 'creditor' : 'both'),
        createdAt: new Date().toISOString(),
        createdBy: currentUserId
      };
      setState(prev => {
        const updated = { ...prev, persons: [...prev.persons, newPerson] };
        saveAppState(updated);
        return updated;
      });
      if (registerAmaniCheck) {
        setCheckPrefillPersonId(newPerson.id);
        setActiveTab('checks');
      }
    }
    setIsAddingDebtor(false);
    setIsAddingCreditor(false);
  };
`;

code = code.replace("  // Add or Edit Person manually\n  const handleAddPerson =", addPersonFn + "\n  // Legacy inline handler\n  const handleAddPerson =");

fs.writeFileSync('src/App.tsx', code);
