from db import q
import sys
def lines(sc):
    _,r=q(f"select l.[Index],l.Col_Code+l.Moien_Code+l.Tafzili_Code acc,left(sf.Sarfasl_Name,28),l.Bed,l.Bes,l.Type_Line,left(l.Comment_Line,55) from SND_LIST l join SARFASL sf on sf.Sarfasl_Code=l.Col_Code+l.Moien_Code+l.Tafzili_Code where l.Sanad_Code={sc} order by l.[Index]")
    for x in r: print('      ',x)
def fact(ft,where):
    _,r=q(f"select top 1 Fac_Code,Fac_Code_C,Fac_Date,C_Code,Sum_Price,FNaghd,FCheck,FNesieh,Card,Takhfif,Sanad_Code,UserCode,StateTax from FACTURE where Fac_Type='{ft}' and {where} order by newid()")
    f=r[0]; print('INVOICE',ft,f)
    _,c=q(f"select C_Code,left(C_Name,25),Col_Code_Bed+Moien_Code_Bed+Tafzili_Code_Bed from CUSTOMER where C_Code='{f[3]}'"); print('  PERSON',c)
    _,a=q(f"select A_Code,A_Index,Few_Article,Price_BS,Buy_Price,DarsadTakhfif,TakhfifSatriR from FACTART where Fac_Code='{f[0]}' and Fac_Type='{ft}'"); print('  ITEMS',a)
    _,s=q(f"select Sanad_Code,Sanad_Code_C,Sanad_Date,Sanad_Type,UserCodeInc from SANAD where Sanad_Code={f[10] or 0}"); print('  SANAD',s)
    lines(f[10] or 0)
    _,i=q(f"select * from SND_INDX where Fac_Code='{f[0]}' and Fac_Type='{ft}'"); print('  SND_INDX',i)
    for (sc,fc,ftp,cc,_) in i:
        if cc:
            _,ch=q(f"select Check_Code,Check_Number,Cust,Receive_Date,Bank_Code,C_Code_Source,Vosool,DarJaryan,Bargashty from [Check] where Check_Code={cc}"); print('   CHECK',ch)
            _,ev=q(f"select State,Date_Time,Sanad_Code,SarFasl_Code from Check_Event where Check_Code={cc} order by Id"); print('   EVENTS',ev)
    _,t=q(f"select FTaxId,StateTax,SendDateTax from TaxLog where Fac_Code='{f[0]}' and Fac_Type='{ft}'"); print('  TAXLOG',t)
    _,p=q(f"select rtrim(KindProc)+rtrim(NameProc),DateProc,TimeProc,User_Code,left(Comment,70) from Process where Comment like '%{f[1]}%' and rtrim(NameProc) in ('F','K','C','S')"); print('  PROCESS',p[:5])
    return f
if __name__=='__main__':
    fact(sys.argv[1], sys.argv[2])
