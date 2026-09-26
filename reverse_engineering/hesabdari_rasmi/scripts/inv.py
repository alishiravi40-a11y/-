from db import q
import json, os
out={}
_,objs=q("select o.name,o.type_desc,m.definition from sys.objects o join sys.sql_modules m on m.object_id=o.object_id where o.is_ms_shipped=0")
for n,t,d in objs:
    open(f'code/{t}__{n}.sql','w').write(d or '')
print(len(objs))
cols,rows=q("""select t.name tbl,c.column_id,c.name col,ty.name type,c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity,
 dc.definition dflt, c.collation_name from sys.tables t join sys.columns c on c.object_id=t.object_id join sys.types ty on ty.user_type_id=c.user_type_id
 left join sys.default_constraints dc on dc.object_id=c.default_object_id order by t.name,c.column_id""")
import csv
w=csv.writer(open('columns.csv','w')); w.writerow(cols); w.writerows(rows)
cols,rows=q("""select t.name tbl,i.name idx,i.type_desc,i.is_primary_key,i.is_unique,i.is_unique_constraint,
 stuff((select ','+c.name+case when ic.is_descending_key=1 then ' DESC' else '' end from sys.index_columns ic join sys.columns c on c.object_id=ic.object_id and c.column_id=ic.column_id where ic.object_id=i.object_id and ic.index_id=i.index_id and ic.is_included_column=0 order by ic.key_ordinal for xml path('')),1,1,'') keys,
 i.filter_definition from sys.tables t join sys.indexes i on i.object_id=t.object_id where i.type>0 order by 1,2""")
w=csv.writer(open('indexes.csv','w')); w.writerow(cols); w.writerows(rows)
cols,rows=q("""select fk.name, object_name(fk.parent_object_id), object_name(fk.referenced_object_id),
 stuff((select ','+col_name(fc.parent_object_id,fc.parent_column_id)+'->'+col_name(fc.referenced_object_id,fc.referenced_column_id) from sys.foreign_key_columns fc where fc.constraint_object_id=fk.object_id for xml path('')),1,1,''), fk.delete_referential_action_desc, fk.is_disabled from sys.foreign_keys fk""")
print('FKs',rows)
cols,rows=q("select object_name(parent_object_id),name,definition,is_disabled from sys.check_constraints")
print('CHECKs',rows)
cols,rows=q("select name,system_type_id from sys.types where is_user_defined=1"); print('UDT',rows)
cols,rows=q("select name,type_desc from sys.objects where is_ms_shipped=0 and type not in ('U','PK','D','P','V','FN','IF','TF','TR','UQ')"); print('other',rows)
cols,rows=q("select s.name,o.name,o.type_desc from sys.synonyms s join sys.objects o on 1=0"); 
cols,rows=q("select name, type_desc from sys.database_principals where type in ('S','U','R') and principal_id>4"); print('principals',rows)
cols,rows=q("select name from sys.schemas"); print('schemas',[r[0] for r in rows])
cols,rows=q("select t.name,tr.name,tr.is_disabled from sys.triggers tr left join sys.tables t on t.object_id=tr.parent_id"); print('triggers',rows)
