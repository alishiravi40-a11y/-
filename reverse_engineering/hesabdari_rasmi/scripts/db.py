import pymssql, sys, os
def conn():
    return pymssql.connect('localhost','sa',os.environ.get("MSSQL_SA_PASSWORD",""),'holoo1_1404',charset='UTF-8',tds_version='7.4')
def q(sql, *a):
    c=conn(); cur=c.cursor(); cur.execute(sql, a if a else None)
    try: rows=cur.fetchall(); cols=[d[0] for d in cur.description]
    except Exception: rows,cols=[],[]
    c.close(); return cols,rows
def show(sql, maxw=40, limit=200):
    cols,rows=q(sql)
    print(' | '.join(cols))
    for r in rows[:limit]:
        print(' | '.join((str(x) if not isinstance(x,bytes) else x.hex())[:maxw] for x in r))
    print(f'-- {len(rows)} rows')
if __name__=='__main__':
    show(sys.stdin.read(), int(sys.argv[1]) if len(sys.argv)>1 else 40, int(sys.argv[2]) if len(sys.argv)>2 else 200)
