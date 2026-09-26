from db import q
import json, collections, datetime, statistics
out={}
# year-end balances per 103/108 account before closing
_,r=q("""select l.Col_Code+l.Moien_Code+l.Tafzili_Code acc, sum(Bed)-sum(Bes) bal from SND_LIST l where l.Sanad_Code<>371084 and l.Col_Code in ('103') group by l.Col_Code+l.Moien_Code+l.Tafzili_Code having abs(sum(Bed)-sum(Bes))>0.5""")
deb=[b for a,b in r if b>0]; cred=[b for a,b in r if b<0]
deb.sort(reverse=True)
out['ar']={'accounts_debit':len(deb),'total_debit':sum(deb),'accounts_credit':len(cred),'total_credit':sum(cred),'top10_share':sum(deb[:10])/sum(deb),'max':deb[0]}
# FIFO collection days on 103 accounts
_,rows=q("""select l.Col_Code+l.Moien_Code+l.Tafzili_Code acc, s.Sanad_Date, l.Bed, l.Bes, s.Sanad_Code from SND_LIST l join SANAD s on s.Sanad_Code=l.Sanad_Code where l.Col_Code='103' and s.Sanad_State=0 order by acc, s.Sanad_Date, s.Sanad_Code, l.[Index]""")
by=collections.defaultdict(list)
for a,d,bd,bs,sc in rows: by[a].append((d,bd or 0,bs or 0,sc))
days=[];wdays=0;wamt=0;unpaid=0
for a,ev in by.items():
    # net within same voucher first
    agg=collections.OrderedDict()
    for d,bd,bs,sc in ev:
        k=(d,sc); x=agg.get(k,[0,0]); x[0]+=bd; x[1]+=bs; agg[k]=x
    queue=[]; credit=0
    for (d,sc),(bd,bs) in agg.items():
        net=bd-bs
        if net>0:
            if credit>0:
                use=min(credit,net); credit-=use; net-=use
            if net>0: queue.append([d,net])
        elif net<0:
            pay=-net
            while pay>0 and queue:
                qd,qa=queue[0]; use=min(pay,qa); dd=(d-qd).days
                wdays+=dd*use; wamt+=use
                if use==qa: queue.pop(0); days.append(dd)
                else: queue[0][1]-=use
                pay-=use
            credit+=pay
    unpaid+=sum(x[1] for x in queue)
out['collection']={'weighted_avg_days':wdays/wamt if wamt else None,'median_days_per_debit':statistics.median(days) if days else None,'settled_debits':len(days),'pct_settled_same_day':sum(1 for x in days if x==0)/len(days),'pct_over_30':sum(1 for x in days if x>30)/len(days),'pct_over_90':sum(1 for x in days if x>90)/len(days),'unpaid_remaining_yearonly':unpaid}
# checks
_,ck=q("select c.Check_Code,c.Cust,c.Receive_Date,c.Attain_Date,c.Export_Date,c.Bank_Code,c.Daryaft_Pardakht from [Check] c")
_,ev=q("select Check_Code,State,Date_Time,Sanad_Code from Check_Event order by Id")
st=collections.defaultdict(list)
for c,s,d,sc in ev: st[c].append((s,d,sc))
rec=[x for x in ck if x[6]]; iss=[x for x in ck if not x[6]]
new_rec=[x for x in rec if st[x[0]][0][2]!=1]  # received this year (not via opening)
bounced=[x for x in rec if any(s in('R','B') for s,_,_ in st[x[0]])]
tenor=[(x[2]-x[3]).days for x in new_rec if x[2] and x[3]]
_,banks=q("select Bank_Code,Bank_Name from NEWBANK"); banks=dict(banks)
bb=collections.Counter(); bt=collections.Counter()
for x in rec:
    bt[banks.get(x[5],x[5])]+=1
    if x in bounced: bb[banks.get(x[5],x[5])]+=1
final=collections.Counter(st[x[0]][-1][0] for x in rec)
out['checks']={'received_total':len(rec),'received_amt':sum(x[1] for x in rec),'received_new_in_year':len(new_rec),'received_new_amt':sum(x[1] for x in new_rec),
 'bounced_cnt':len(bounced),'bounced_amt':sum(x[1] for x in bounced),'bounce_rate_cnt':len(bounced)/len(rec),'bounce_rate_amt':sum(x[1] for x in bounced)/sum(x[1] for x in rec),
 'tenor_median_days':statistics.median(tenor),'tenor_p90':sorted(tenor)[int(len(tenor)*.9)],
 'final_state_received':dict(final),'issued_total':len(iss),'issued_amt':sum(x[1] for x in iss),
 'issued_final_state':dict(collections.Counter(st[x[0]][-1][0] for x in iss)),
 'bank_bounce':sorted([(k,bt[k],bb[k],bb[k]/bt[k]) for k in bt if bt[k]>=100],key=lambda x:-x[3])[:10]}
# repeat bouncers
cust_b=collections.Counter()
_,cs=q("select Check_Code,C_Code_Source from [Check] where Daryaft_Pardakht=1")
csd=dict(cs)
for x in bounced: cust_b[csd.get(x[0])]+=1
out['checks']['customers_with_bounces']=len(cust_b); out['checks']['customers_3plus_bounces']=sum(1 for v in cust_b.values() if v>=3)
# overdue in hand at year-end: last state D or R or S (in cash) with due < 2026-03-20
yend=datetime.datetime(2026,3,20)
inhand=[x for x in rec if st[x[0]][-1][0] in ('D','S','R','M')]
out['checks']['in_hand_yearend_cnt']=len(inhand); out['checks']['in_hand_amt']=sum(x[1] for x in inhand)
out['checks']['in_hand_overdue_cnt']=sum(1 for x in inhand if x[2] and x[2]<yend); out['checks']['in_hand_overdue_amt']=sum(x[1] for x in inhand if x[2] and x[2]<yend)
json.dump(out,open('analytics2.json','w'),ensure_ascii=False,indent=1,default=str)
print(json.dumps(out,ensure_ascii=False,default=str,indent=0))
