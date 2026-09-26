from db import q
import json, collections, datetime, statistics
out={}
_,r=q("select datediff(day,Export_Date,Receive_Date) t, datediff(day,Attain_Date,Receive_Date) t2 from [Check] c where Daryaft_Pardakht=1 and exists(select 1 from Check_Event e where e.Check_Code=c.Check_Code and e.State='D' and e.Sanad_Code<>1)")
t=[x for x,_ in r if x is not None]; t.sort()
out['check_tenor_export_to_due']={'median':statistics.median(t),'p75':t[int(len(t)*.75)],'p90':t[int(len(t)*.9)],'max':t[-1],'n':len(t)}
out['attain_eq_receive']=sum(1 for _,y in r if y==0)/len(r)
# stock at year end by warehouse + dead stock
_,mg=q("select M_groupcode,M_groupname from M_GROUP"); mg=dict(mg)
_,arts=q("select A_Code,A_Name,Exist,Buy_Price,First_exist from ARTICLE where left(A_Code,2)<>'01' and Exist>0")
_,last=q("select fa.A_Code,max(f.Fac_Date) from FACTART fa join FACTURE f on f.Fac_Code=fa.Fac_Code and f.Fac_Type=fa.Fac_Type where f.Fac_Type='F' group by fa.A_Code"); last=dict(last)
_,sold=q("select fa.A_Code,sum(Few_Article) from FACTART fa where Fac_Type='F' group by fa.A_Code"); sold=dict(sold)
yend=datetime.datetime(2026,3,20)
wh=collections.defaultdict(lambda: collections.Counter()); dead=[]
for a,n,e,bp,fe in arts:
    v=e*(bp or 0); w=mg.get(a[:2],a[:2]); wh[w]['value']+=v; wh[w]['qty']+=e; wh[w]['items']+=1
    ls=last.get(a)
    if ls is None or (yend-ls).days>90:
        wh[w]['dead_value']+=v; dead.append((a,n,e,v,str(ls.date()) if ls else None, fe))
out['stock_by_wh']=sorted([(k,dict(v)) for k,v in wh.items()],key=lambda x:-x[1]['value'])
dead.sort(key=lambda x:-x[3]); out['dead_top']=dead[:12]; out['dead_total']=sum(x[3] for x in dead); out['dead_items']=len(dead)
out['stock_total']=sum(v['value'] for v in wh.values())
# purchase price trends for top models: first vs last K price
_,kp=q("select a.A_Name,f.Fac_Date,fa.Price_BS,fa.Few_Article from FACTART fa join FACTURE f on f.Fac_Code=fa.Fac_Code and f.Fac_Type=fa.Fac_Type join ARTICLE a on a.A_Code=fa.A_Code where f.Fac_Type='K' and fa.Price_BS>0 order by f.Fac_Date")
pp=collections.defaultdict(list)
for n,d,p,few in kp: pp[n.strip()].append((d,p,few))
trend=[]
for n,v in pp.items():
    if sum(x[2] for x in v)>=200 and len(v)>=5:
        trend.append((n,str(v[0][0].date()),v[0][1],str(v[-1][0].date()),v[-1][1],v[-1][1]/v[0][1]-1,min(x[1] for x in v),max(x[1] for x in v)))
out['purchase_price_trend']=sorted(trend,key=lambda x:-abs(x[5]))[:12]
# supplier concentration
_,sup=q("select c.C_Name,sum(f.Sum_Price) s,count(*) n from FACTURE f join CUSTOMER c on c.C_Code=f.C_Code where f.Fac_Type='K' group by c.C_Name order by s desc")
tot=sum(x[1] for x in sup); out['suppliers']={'n':len(sup),'top1_share':sup[0][1]/tot,'top5_share':sum(x[1] for x in sup[:5])/tot,'top10_share':sum(x[1] for x in sup[:10])/tot}
# user activity
_,ua=q("select User_Code,rtrim(KindProc)+rtrim(NameProc) k,count(*) from Process where rtrim(KindProc) in ('A','E','D') group by User_Code,rtrim(KindProc)+rtrim(NameProc)")
u=collections.defaultdict(dict)
for uc,k,n in ua: u[uc][k]=n
out['user_activity']=u
# edits after print / edits per invoice
_,e=q("select count(distinct Number) from Process where rtrim(KindProc)='E' and rtrim(NameProc)='F'"); out['sales_invoices_edited']=e[0][0]
# same customer same day same amount duplicate sales
_,d=q("select count(*),sum(n-1) from (select C_Code,Fac_Date,Sum_Price,count(*) n from FACTURE where Fac_Type='F' group by C_Code,Fac_Date,Sum_Price having count(*)>1) x"); out['dup_sales_same_cust_day_amt']=d[0]
_,d=q("select count(*) from FACTURE where Fac_Type='F' and Sum_Price=0"); out['zero_sales']=d[0][0]
# expense structure from closing
_,ex=q("select left(sf.Sarfasl_Name,40),l.Bes from SND_LIST l join SARFASL sf on sf.Sarfasl_Code=l.Col_Code+l.Moien_Code+l.Tafzili_Code where l.Sanad_Code=371083 and l.Col_Code in ('601','602') order by l.Bes desc")
out['expenses_top']=ex[:15]; out['expenses_total']=sum(x[1] for x in ex)
json.dump(out,open('analytics3.json','w'),ensure_ascii=False,indent=1,default=str)
print(json.dumps(out,ensure_ascii=False,default=str)[:7000])
