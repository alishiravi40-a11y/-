# بازتولید محیط تحلیل

فایل Backup در مخزن قرار **نمی‌گیرد** (حاوی داده مالی و شخصی است). برای بازتولید:

```bash
# 1) اتصال دو بخش و استخراج
cat 166d3745-hesabdari_rasmi.zip.part0 611dcb23-hesabdari_rasmi.zip.part1 > hesabdari_rasmi.zip
sha256sum hesabdari_rasmi.zip      # 57951a16e7c2403258b5c4ecae0b0f61f7432605fd46b33b51a10f02853b4ef8
unzip hesabdari_rasmi.zip          # -> holoo1_1404
sha256sum holoo1_1404              # c6784144353300b37343866715dcbb41530f262a95536c35807260a114bca2b2
mkdir bak && cp holoo1_1404 bak/holoo1_1404.bak && chmod -R 777 bak   # روی کپی کار کنید

# 2) SQL Server (هر نسخه >= 2014؛ اینجا 2022)
export MSSQL_SA_PASSWORD='<strong-password>'
docker run -d --name mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$MSSQL_SA_PASSWORD" \
  -e MSSQL_COLLATION=Arabic_CI_AS -p 1433:1433 -v "$PWD/bak:/bak" mcr.microsoft.com/mssql/server:2022-latest

# 3) Restore
docker exec mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -Q "
RESTORE HEADERONLY FROM DISK='/bak/holoo1_1404.bak';
RESTORE FILELISTONLY FROM DISK='/bak/holoo1_1404.bak';
RESTORE DATABASE holoo1_1404 FROM DISK='/bak/holoo1_1404.bak'
  WITH MOVE 'Holoo_Data' TO '/var/opt/mssql/data/holoo1_1404.mdf',
       MOVE 'Holoo_Log'  TO '/var/opt/mssql/data/holoo1_1404.ldf';
DBCC CHECKDB('holoo1_1404') WITH NO_INFOMSGS;"

# 4) اسکریپت‌ها
pip install pymssql jdatetime
cd scripts && python3 inv.py && python3 analytics.py && python3 analytics2.py && python3 analytics3.py
python3 trace.py F "FCheck>0"      # ردیابی End-to-End یک فاکتور تصادفی
```

همه اسکریپت‌ها فقط `SELECT` اجرا می‌کنند.
