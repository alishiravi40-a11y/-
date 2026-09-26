from db import q
import collections
_,arts=q("select A_Code,isnull(First_exist,0),isnull(FirstBuy_Price,0),isnull(Buy_Price,0),isnull(Exist,0) from ARTICLE where left(A_Code,2)<>'01'")
_,mv=q("""select fa.A_Code,f.Fac_Type,f.Fac_Date,f.Fac_Time,fa.A_Index,fa.Few_Article,fa.Price_BS,isnull(fa.Buy_Price,0),f.Fac_Code,isnull(f.HazFactK,0),isnull(f.Sum_Few,0),isnull(fa.DarsadTakhfif,0),isnull(fa.TakhfifSatriR,0)
 from FACTART fa join FACTURE f on f.Fac_Code=fa.Fac_Code and f.Fac_Type=fa.Fac_Type where f.Fac_Type in ('K','F','Y','X','Z','S','D')""")
by=collections.defaultdict(list)
order={'K':1,'F':2,'Y':3,'X':4,'Z':5,'D':6,'S':7}
for m in mv: by[m[0]].append(m)
res=collections.Counter(); final=collections.Counter(); examples=[]
for a,fe,fbp,bp,ex in arts:
    qty=fe; val=fe*fbp; avg=fbp
    rows=sorted(by[a],key=lambda m:(m[2],m[3] or 0 and 0, order[m[1]], m[8], m[4])) if by[a] else []
    for (_,t,d,tm,idx,few,price,buy,fc,haz,sf,dt,tr) in rows:
        if t in('F','X','Z','S'):
            ok=abs(buy-avg)<=max(1,abs(avg)*1e-6)
            res[(t,ok)]+=1
            if not ok and len(examples)<5: examples.append((a,t,fc,d,buy,avg))
            qty-=few; val=qty*avg
        else:
            inprice = price if t=='K' else buy
            if t=='K': res[('K_buy_eq_prevavg',abs(buy-avg)<=max(1,abs(avg)*1e-6))]+=1
            val+=few*inprice; qty+=few
            avg = val/qty if qty>0 else inprice
    final[abs(avg-bp)<=max(1,abs(bp)*1e-6)]+=1
print(res); print('final avg matches ARTICLE.Buy_Price:',final); print(examples)
