const fs = require('fs');
let code = fs.readFileSync('src/components/PartnerDashboard.tsx', 'utf-8');

const target = `              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black text-zinc-900">مدیریت مشتریان من</h2>
                <div className="relative w-64">
                  <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input 
                    type="text" 
                    placeholder="جستجو در نام یا کد ملی..." 
                    className="w-full pr-10 pl-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>`;

const replacement = `              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h2 className="text-2xl font-black text-zinc-900">مدیریت مشتریان من</h2>
                  <button 
                    onClick={() => setIsAddingCustomer(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition"
                  >
                    <UserPlus size={18} />
                    ایجاد مشتری جدید
                  </button>
                </div>
                <div className="relative w-64">
                  <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input 
                    type="text" 
                    placeholder="جستجو در نام یا کد ملی..." 
                    className="w-full pr-10 pl-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              
              {isAddingCustomer && (
                <div className="mb-6">
                  <PersonForm 
                    isDebtor={true}
                    hideAmaniCheck={true}
                    onSave={(personData) => {
                      onAddCustomer(personData);
                      setIsAddingCustomer(false);
                    }}
                    onCancel={() => setIsAddingCustomer(false)}
                  />
                </div>
              )}`;

code = code.replace(target, replacement);
fs.writeFileSync('src/components/PartnerDashboard.tsx', code);
