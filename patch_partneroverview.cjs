const fs = require('fs');
let code = fs.readFileSync('src/components/PartnerDashboard.tsx', 'utf-8');

const target = `                    <button 
                      onClick={() => setActiveTab('customers')}
                      className="bg-white/10 hover:bg-white/20 p-4 rounded-2xl border border-white/10 transition-all text-right group"
                    >
                      <UserPlus className="text-blue-400 mb-2 group-hover:scale-110 transition-transform" size={24} />
                      <div className="font-bold text-sm">افزودن مشتری</div>
                    </button>`;

const replacement = `                    <button 
                      onClick={() => {
                        setActiveTab('customers');
                        setIsAddingCustomer(true);
                      }}
                      className="bg-white/10 hover:bg-white/20 p-4 rounded-2xl border border-white/10 transition-all text-right group"
                    >
                      <UserPlus className="text-blue-400 mb-2 group-hover:scale-110 transition-transform" size={24} />
                      <div className="font-bold text-sm">افزودن مشتری</div>
                    </button>`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/PartnerDashboard.tsx', code);
