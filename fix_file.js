const fs = require('fs');
let content = fs.readFileSync('src/components/CalculatorManagementCenter.tsx', 'utf-8');
const searchStr = `                  const overridesCount = getActiveCalculatorOverridesCount(partner.calculatorOverrides);
                      const types = new Set();
                      Object.values(partner.calculatorOverrides).forEach((o: any) => {
                        if (o && o.isActive !== false && o.calculatorId) {
                          types.add(o.calculatorId);
                        }
                      });
                      overridesCount = types.size;
                    }
                  }`;

const replaceStr = `                  const overridesCount = getActiveCalculatorOverridesCount(partner.calculatorOverrides);`;
content = content.replace(searchStr, replaceStr);
fs.writeFileSync('src/components/CalculatorManagementCenter.tsx', content);
