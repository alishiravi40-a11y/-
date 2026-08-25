import re

with open('src/components/AgentManager.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Typography and label fixes
content = content.replace("نماینده فروش", "نماینده اعتباری")
content = content.replace("فروشگاه نماینده", "دفتر نماینده اعتباری")
content = content.replace("مرکز مدیریت نمایندگان اعتباری", "مرکز مدیریت نمایندگان اعتباری")
content = content.replace("text-xs", "text-[13px]")
content = content.replace("text-[10px]", "text-[11px]")
content = content.replace("text-[9px]", "text-[10px]")
content = content.replace("text-[11px]", "text-xs")

# 2. Spacing and Card Flattening
# A lot of cards have bg-white border border-zinc-200 p-4 etc.
# We'll flatten nested cards by making the inner ones just have no background or a very subtle one without thick borders.
content = content.replace('bg-zinc-50 border border-zinc-200 rounded-lg p-3', 'bg-transparent border-b border-zinc-100 py-3')
content = content.replace('bg-zinc-50 border border-zinc-100 rounded-xl p-2', 'bg-transparent border-b border-zinc-100 py-3')
content = content.replace('bg-white p-4 rounded-2xl border border-zinc-150 shadow-sm', 'bg-white p-6 rounded-2xl border border-zinc-200/60 shadow-sm')
content = content.replace('bg-white p-3 rounded-2xl border border-zinc-200 shadow-sm', 'bg-white p-4 rounded-xl border border-zinc-200/60 shadow-sm hover:shadow-md transition-shadow')

# Buttons 
content = content.replace('bg-zinc-900 hover:bg-zinc-800', 'bg-indigo-600 hover:bg-indigo-700')
content = content.replace('text-zinc-500', 'text-zinc-600')

with open('src/components/AgentManager.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
