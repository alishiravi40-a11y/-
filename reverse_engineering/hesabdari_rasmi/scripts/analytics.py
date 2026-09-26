from db import q
import jdatetime, json, collections, datetime
def jm(d): j=jdatetime.date.fromgregorian(date=d.date() if isinstance(d,datetime.datetime) else d); return f"{j.year}/{j.month:02d}"
out={}
_,mg=q("select M_groupcode,M_groupname from M_GROUP"); mg=dict(mg)
_,rows=q("""select f.Fac_Type,f.Fac_Date,f.C_Code,f.Sum_Price,f.Card,f.FNesieh,f.FCheck,f.FNaghd,fa.A_Code,fa.Few_Article,fa.Price_BS,isnull(fa.Buy_Price,0),a.A_Name,f.Fac_Code
 from FACTURE f join FACTART fa on fa.Fac_Code=f.Fac_Code and fa.Fac_Type=f.Fac_Type join ARTICLE a on a.A_Code=fa.A_Code where f.Fac_Type in ('F','Y','K','X')""")
m=collections.defaultdict(lambda: collections.Counter())
wh=collections.defaultdict(lambda: collections.Counter())
brand=collections.defaultdict(lambda: collections.Counter())
prod=collections.defaultdict(lambda: collections.Counter())
for t,d,c,sp,card,ns,ch,nq,ac,few,pr,bp,nm,fc in rows:
    if t!='F' or ac.startswith('01'): 
        if t=='K': m[jm(d)]['purchase']+=few*pr
        continue
    rev=few*pr; cogs=few*bp; k=jm(d)
    m[k]['rev']+=rev; m[k]['cogs']+=cogs; m[k]['qty']+=few
    w=mg.get(ac[:2],ac[:2]); wh[w]['rev']+=rev; wh[w]['cogs']+=cogs; wh[w]['qty']+=few
    b=(nm or '').split('/')[0].strip(); brand[b]['rev']+=rev; brand[b]['cogs']+=cogs; brand[b]['qty']+=few
    p=nm.strip(); prod[p]['rev']+=rev; prod[p]['cogs']+=cogs; prod[p]['qty']+=few
    if pr<bp: m[k]['below_cost_lines']+=1
_,inv=q("select Fac_Date,Sum_Price,Card,FNesieh,FCheck,FNaghd,C_Code from FACTURE where Fac_Type='F'")
for d,sp,card,ns,ch,nq,c in inv:
    k=jm(d); m[k]['invoices']+=1; m[k]['card']+=card or 0; m[k]['credit']+=ns or 0; m[k]['check']+=ch or 0; m[k]['cash']+=nq or 0
out['monthly']={k:dict(v) for k,v in sorted(m.items())}
out['warehouse']=sorted([(k,dict(v)) for k,v in wh.items()],key=lambda x:-x[1]['rev'])
out['brand']=sorted([(k,dict(v)) for k,v in brand.items()],key=lambda x:-x[1]['rev'])[:15]
pl=[(k,dict(v)) for k,v in prod.items()]
out['top_products']=sorted(pl,key=lambda x:-x[1]['rev'])[:15]
out['worst_margin_products']=sorted([x for x in pl if x[1]['rev']>0],key=lambda x:(x[1]['rev']-x[1]['cogs']))[:10]
out['n_products_sold']=len(pl)
# customers
cc=collections.Counter(c for _,_,_,_,_,_,c in inv); amt=collections.Counter()
for d,sp,*_ ,c in inv: amt[c]+=sp
out['customers']={'buyers':len(cc),'one_time':sum(1 for v in cc.values() if v==1),'2_5':sum(1 for v in cc.values() if 2<=v<=5),'gt5':sum(1 for v in cc.values() if v>5),
  'top10_share':sum(v for _,v in amt.most_common(10))/sum(amt.values()),'top100_share':sum(v for _,v in amt.most_common(100))/sum(amt.values())}
json.dump(out,open('analytics.json','w'),ensure_ascii=False,indent=1,default=str)
print(json.dumps(out,ensure_ascii=False,default=str)[:6000])
