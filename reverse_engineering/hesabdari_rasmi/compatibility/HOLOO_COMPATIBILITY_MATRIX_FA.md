# Holoo Compatibility Matrix — حسابداری رسمی الماس شهر

> منبع اصلی: `compatibility/build_matrix.py` (ویرایش فقط در آن فایل) → `holoo_compatibility_matrix.csv` و همین صفحه.
> این ماتریس معیار پذیرش نرم‌افزار جدید است: هیچ ردیف `MUST` نباید بدون تصمیم ثبت‌شده حذف شود.

## خلاصه

| دسته | تعداد |
|---|---:|
| A — حفظ عین منطق | 31 |
| B — حفظ با طراحی بهتر | 30 |
| C — جایگزین مدرن | 24 |
| D — نیازمند تصمیم/اطلاعات | 8 |

| نیاز | تعداد |
|---|---:|
| MUST | 73 |
| SHOULD | 11 |
| OPTIONAL | 6 |
| NO | 3 |

| وضعیت آینده | تعداد |
|---|---:|
| READER_READY | 36 |
| TODO | 28 |
| DESIGNED | 20 |
| VERIFIED | 9 |

## حسابداری

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | کدینگ سه‌سطحی کل/معین/تفصیلی | `SARFASL(Col,Moien,Tafzili,Sarfasl_Code,Parent,SParent)` | PROVEN | 33,564 حساب | MUST | B | همه کدها و نام‌ها و درخت پس از Import برابر؛ تعداد هر سطح | READER_READY |
| ACC-02 | حساب شخص در سطح معین (کدینگ ترکیبی قدیمی) | `CUSTOMER.*_Bed/_Bes → SARFASL (len 7)` | PROVEN | 9,977 شخص | MUST | B | نگاشت شخص↔حساب برای هر C_Code برابر؛ مانده هر شخص برابر | READER_READY |
| ACC-03 | ماهیت حساب، گروه ترازنامه/سود و زیان | `SARFASL.Mahiat, Group → GROP_SAR` | PROVEN | همه حساب‌ها | MUST | A | ترازنامه و سود و زیان بازسازی‌شده = سند بستن هلو | READER_READY |
| ACC-04 | نقش سیستمی حساب‌ها (حساب پیش‌فرض عملیات) | `SarfaslType(59), SARFASL.Type, MSETUP2 Sar*` | PROVEN | فعال | MUST | B | هر نقش به همان حساب نگاشت شود | READER_READY |
| ACC-05 | سند و ردیف سند (بدهکار/بستانکار) | `SANAD, SND_LIST` | PROVEN | 47,447 سند / 190,469 ردیف | MUST | A | C-01..C-02؛ جمع بد/بس هر سند و کل برابر | VERIFIED |
| ACC-06 | شماره ثابت + شماره عطف (بازشماره‌گذاری به ترتیب تاریخ) | `SANAD.Sanad_Code, Sanad_Code_C/_C2` | PROVEN | فعال | MUST | B | هر دو شماره حفظ؛ ترتیب عطف = ترتیب تاریخ | READER_READY |
| ACC-07 | انواع سند (فروش/خرید/دستی/دریافت/پرداخت/انتقال/چک/کارمزد) | `SANAD.Sanad_Type` | PROVEN | فعال | MUST | A | توزیع انواع و الگوی حساب هر نوع برابر | READER_READY |
| ACC-08 | نوع ردیف (F/S/Z/خالی) برای ارتباط ردیف با فاکتور و تسویه | `SND_LIST.Type_Line` | PROVEN | فعال | MUST | B | Type_Line هر ردیف حفظ و به نقش معنایی نگاشت | READER_READY |
| ACC-09 | ردیف خارج از دفتر (Show_Daftar=0) — سازوکار ابطال فاکتور | `SND_LIST.Show_Daftar` | PROVEN | 14 ردیف | MUST | C | Reader: ردیف‌های پنهان خارج از دفتر؛ سیستم جدید: سند معکوس به‌جای پنهان‌سازی | READER_READY |
| ACC-10 | افتتاحیه/بستن موقت/اختتامیه | `SANAD.sanad_state 1/2/3؛ حساب 005/006` | PROVEN | فعال | MUST | B | سند بستن بازتولیدشده = سند هلو؛ همه حساب‌ها پس از اختتامیه صفر (R-07) | VERIFIED |
| ACC-11 | موجودی ادواری و COGS در بستن سال | `اسناد بستن + ARTICLE.Exist×Buy_Price` | PROVEN | فعال | MUST | B | COGS=7,699,284,125,059 بازتولید شود | VERIFIED |
| ACC-12 | مانده حساب (دفتر کل/معین/تفصیلی) | `MandehOfSarfasl, W_SarfaslMandeh` | PROVEN | گزارش پرکاربرد | MUST | A | مانده هر حساب در هر تاریخ برابر | VERIFIED |
| ACC-13 | Cache مانده حساب | `SARFASL.Mandeh` | PROVEN | فعال | NO | C | جایگزین: محاسبه/Materialized view با کنترل | DESIGNED |
| ACC-14 | نسخه‌های سند افتتاحیه | `Sanad_Edit, snd_list_Edit` | PROVEN | 12 | MUST | B | همه نسخه‌ها Import و قابل مقایسه | READER_READY |
| ACC-15 | دفتر روزنامه، دفتر معین، مرور حساب | `گزارش‌های هلو (Log A4)` | PROVEN | 143+13+8 اجرا | MUST | A | خروجی برای یک ماه نمونه با هلو برابر | TODO |
| ACC-16 | ترازنامه آزمایشی ۲/۴/۶/۸ ستونی | `گزارش هلو` | PROVEN | 13 اجرا | MUST | A | تراز ۴ ستونی پایان سال برابر | TODO |
| ACC-17 | مرکز هزینه | `SND_LIST.MHaz_Code` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| ACC-18 | ارز | `SND_LIST.Bed_Arz/ArzId, MONEY` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| ACC-19 | حساب‌های انتظامی (چک ضمانت) | `001/002, TAZMIN` | PROVEN | 399 چک | MUST | A | مانده انتظامی = جمع TAZMIN باز | DESIGNED |
| ACC-20 | کارتابل/تأیید/قطعی‌سازی سند | `SANAD.End_Save, Review, StateSanadForKartabl` | PROVEN | استفاده نشده | MUST | C | جایگزین: گردش تأیید + قفل دوره | DESIGNED |
| ACC-21 | کنترل پنجره زمانی ثبت سند برای کاربر | `USERDB.InsSanadBefor/SanadTimeInsertValueBefore, EnterPriorDate` | NEEDS_MORE_EVIDENCE | 5 کاربر | MUST | C | جایگزین: قفل دوره + مجوز استثنا با Audit | DESIGNED |

## اشخاص

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| PER-01 | پرونده شخص (حقیقی/حقوقی، کد ملی، اقتصادی، آدرس، موبایل) | `CUSTOMER, Cust_Tell, FactOther` | PROVEN | 32,696 شخص | MUST | B | همه فیلدهای پرکاربرد Import و برابر | READER_READY |
| PER-02 | نقش شخص (خریدار/فروشنده/واسطه/پرسنل/…) | `CUSTOMER.Kharid/Forosh/Vaseteh/…` | PROVEN | تقریباً همه | SHOULD | C | جایگزین: نقش استنتاجی از رفتار + نقش صریح | DESIGNED |
| PER-03 | دو حساب بدهکار/بستانکار برای هر شخص | `CUSTOMER.*_Bed/*_Bes, CustomerSarfasl` | PROVEN | 306 شخص دوحسابی/تک‌بستانکار | MUST | B | مانده شخص = اجتماع دو حساب | VERIFIED |
| PER-04 | مانده و گردش شخص | `W_Calc_Mandeh_Customer, F_Calc_BedBes_UseInView` | PROVEN | فعال | MUST | A | مانده هر شخص قبل از بستن برابر | VERIFIED |
| PER-05 | سقف اعتبار، مهلت تسویه | `CUSTOMER.Etebar, MohlatTasvieh` | PROVEN | بسیار کم | SHOULD | C | جایگزین: سیاست اعتباری + امتیاز ریسک | DESIGNED |
| PER-06 | لیست سیاه | `CUSTOMER.InListSiah (+ برچسب در نام)` | PROVEN | 8 | MUST | B | همه لیست سیاه + نام‌های دارای «بد حساب» پرچم بخورند | READER_READY |
| PER-07 | گروه پیامک | `CUSTOMER.SMSGroup` | PROVEN | فعال | SHOULD | A | گروه‌ها Import شوند | TODO |
| PER-08 | شهر/منطقه شخص و گزارش فروش استان/شهر | `CUSTOMER.City_Code→CITY` | PROVEN | 4 اجرای گزارش | SHOULD | A | فروش به تفکیک شهر برابر | TODO |
| PER-09 | کشف اشخاص تکراری | `—` | PROVEN | — | SHOULD | C | قابلیت جدید: ادغام کنترل‌شده با حفظ سابقه | TODO |

## فروش

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| SAL-01 | فاکتور فروش (سرفصل + ردیف) | `FACTURE/FACTART Fac_Type=F` | PROVEN | 19,877 | MUST | A | C-09؛ جمع هر فاکتور، ردیف‌ها، روش تسویه برابر | READER_READY |
| SAL-02 | روش‌های تسویه فاکتور (نقد/کارت/چک/نسیه) | `FNaghd/Card/FCheck/FNesieh` | PROVEN | همه | MUST | B | مجموع هر روش در سال برابر | READER_READY |
| SAL-03 | سند خودکار فروش با ردیف‌های دریافت همان لحظه | `Sanad_Type 13` | PROVEN | همه | MUST | B | سند بازتولیدشده = سند هلو برای 100% فاکتورها | READER_READY |
| SAL-04 | ثبت فروش از وب‌سرویس + شماره سفارش در شرح | `Process (وب سرویس)، Fac_Comment «…/شماره»، UserCode=3` | PROVEN | 20,083 | MUST | B | شماره سفارش استخراج و یکتا؛ تطبیق با سامانه فروش | READER_READY |
| SAL-05 | ابطال فاکتور فروش | `Fac_Type Q + SND_LIST.Show_Daftar=0 + TaxLog SendType 3` | PROVEN | 4 | MUST | C | جایگزین: ابطال با سند معکوس خودکار + مؤدیان | READER_READY |
| SAL-06 | برگشت از فروش | `Fac_Type Y؛ سند 14` | PROVEN | 5 | MUST | B | مبالغ و اثر انبار برابر | READER_READY |
| SAL-07 | فاکتور اشانتیون (مبلغ صفر) | `F با Sum_Price=0` | PROVEN | 4 | SHOULD | B | — | TODO |
| SAL-08 | تخفیف ردیف/فاکتور، پورسانت، واسطه | `DarsadTakhfif, Takhfif, DarsadPorsant, Vaseteh_Code` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| SAL-09 | سطوح قیمت فروش (۱۰۰ سطح) و ArticlePrice | `ARTICLE.Sel_Price1..100, ArticlePrice` | NEEDS_MORE_EVIDENCE | کم | SHOULD | C | جایگزین: فهرست قیمت نسخه‌دار | TODO |
| SAL-10 | پیش‌فاکتور | `FBAILPRE/ABAILPRE (P)` | PROVEN | 8 | OPTIONAL | D | — | TODO |
| SAL-11 | حاشیه سود ردیف (بهای میانگین در ردیف) | `FACTART.Buy_Price` | PROVEN | فعال | MUST | C | جایگزین: بازمحاسبه بها پس از ثبت عقب‌افتاده | DESIGNED |
| SAL-12 | گزارش فاکتور ستونی/تیتر/خلاصه | `گزارش هلو` | PROVEN | پرکاربردترین | MUST | A | خروجی ماه نمونه برابر | TODO |
| SAL-14 | تطبیق سند کانال فروش/خرید وب با سند هلو | `WEBBLOB ↔ FACTURE/FACTART` | PROVEN | فعال | MUST | C | R-10a؛ جایگزین: منبع حقیقت واحد + تطبیق | READER_READY |
| SAL-13 | بالاترین فروش به اشخاص/کالاها | `گزارش هلو` | PROVEN | فعال | MUST | A | رتبه‌بندی برابر | TODO |

## خرید

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| PUR-01 | فاکتور خرید | `FACTURE/FACTART K؛ سند 14` | PROVEN | 942 | MUST | A | مبالغ، ردیف‌ها و اثر میانگین برابر | READER_READY |
| PUR-02 | برگشت از خرید | `X؛ سند 13` | PROVEN | 1 | MUST | A | برابر | READER_READY |
| PUR-03 | اقلام خدماتی در فاکتور خرید (کارمزد/حمل) | `FACTART روی کالاهای 01xxx` | PROVEN | فعال | SHOULD | C | جایگزین: هزینه‌های جانبی خرید با تسهیم | TODO |
| PUR-04 | بالاترین خرید از اشخاص | `گزارش هلو` | PROVEN | فعال | SHOULD | A | برابر | TODO |

## کالا

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| INV-01 | کالا با کد ۷ رقمی گروه/زیرگروه/سریال | `ARTICLE, M_GROUP, S_GROUP` | PROVEN | 9,607 کالا | MUST | B | کد و نام کالا برابر | READER_READY |

## انبار

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| INV-02 | انبار = گروه اصلی؛ هر مدل در هر انبار کالای جدا | `M_GROUP; حواله S/D` | PROVEN | 20 گروه | MUST | C | جایگزین: کالای واحد × انبار؛ Import باید کالاهای هم‌نام را یکی کند | DESIGNED |
| INV-03 | حواله بین انبارها (بدون سند) | `FACTURE S/D` | PROVEN | 482 | MUST | B | مقدار و ارزش انتقال برابر | READER_READY |
| INV-04 | موجودی = اول دوره + ورودی − خروجی | `ARTICLE.Exist, FACTART` | PROVEN | فعال | MUST | A | C-07 / E11.1 | VERIFIED |
| INV-05 | میانگین موزون متحرک | `ARTICLE.Buy_Price, FACTART.Buy_Price` | PROVEN | فعال | MUST | B | ارزش پایان دوره هر کالا برابر؛ اختلاف‌ها توضیح داده شوند | DESIGNED |
| INV-06 | منع منفی شدن موجودی | `MSETUP2.Negative_*` | NEEDS_MORE_EVIDENCE | ناقص | MUST | C | جایگزین: کنترل منفی بر مبنای تاریخ مؤثر | DESIGNED |
| INV-07 | ضایعات | `FACTURE Z؛ سند 6010006/8010001` | PROVEN | 3 | MUST | B | برابر | READER_READY |
| INV-08 | انبارگردانی | `sp_AnbarGard*` | PROVEN | استفاده نشده | MUST | C | قابلیت جدید با سند اصلاح موجودی | TODO |
| INV-09 | کاردکس مقداری و ریالی کالا | `W_ArtKardex*, گزارش هلو` | PROVEN | فعال | MUST | A | کاردکس یک کالای نمونه برابر | VERIFIED |
| INV-10 | گزارش وضعیت انبار / موجودی به تفکیک انبار | `گزارش هلو` | PROVEN | فعال | MUST | A | برابر | TODO |

## کالا

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| INV-11 | کد جایگزین/بارکد، شناسه مالیاتی کالا | `A_Code_C, ArticleCodes, A_codeIdTax` | PROVEN | فعال | MUST | A | برابر | TODO |
| INV-12 | حداقل/حداکثر، محل نگهداری، تصویر، سریال، انقضا | `A_Min/A_Max, Place, Picture, ANB_SER, EXPDate` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| INV-13 | موجودی اول دوره منفی از سال قبل | `ARTICLE.First_exist<0` | PROVEN | 12 | MUST | C | Import باید هشدار دهد؛ سیستم جدید اجازه ندهد | READER_READY |

## خزانه

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| TRE-01 | صندوق‌ها و تنخواه (درختی) با حساب چک صندوق | `Cash(Sarfasl_Code, Sarfasl_Code2)` | PROVEN | 5 صندوق | MUST | A | مانده صندوق‌ها برابر | READER_READY |
| TRE-02 | حساب‌های بانکی، POS، درگاه، شبا، کارمزد | `ACOUND_N, NEWBANK` | PROVEN | فعال | MUST | B | همه حساب‌ها و مانده‌ها برابر | READER_READY |
| TRE-03 | دریافت (کارت/نقد/چک) و رسید | `سند 4/8/20, SaveResid` | PROVEN | فعال | MUST | B | برابر | DESIGNED |
| TRE-04 | پرداخت | `سند 5` | PROVEN | فعال | MUST | A | برابر | DESIGNED |
| TRE-05 | انتقال بین بانک‌ها / واریز POS | `سند 1` | PROVEN | فعال | MUST | A | برابر | DESIGNED |
| TRE-06 | کارمزد بانکی | `سند 7/20 → 6010009` | PROVEN | فعال | MUST | A | برابر | DESIGNED |
| TRE-07 | تسویه فاکتور نسیه (تخصیص دریافت به فاکتور) | `— (وجود ندارد)` | PROVEN | ندارد | MUST | C | قابلیت جدید: تخصیص FIFO/دستی + سن‌بندی | DESIGNED |
| TRE-08 | ریز عملکرد بانک | `گزارش هلو` | PROVEN | فعال | MUST | A | برابر | TODO |
| TRE-09 | اقساط | `GHEST` | PROVEN | کم | OPTIONAL | D | — | TODO |

## چک

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| CHQ-01 | چک دریافتی/پرداختی با بانک، شعبه، شماره، صیاد، صاحب | `Check, Check_Bkup` | PROVEN | فعال | MUST | B | همه چک‌ها و مبالغ برابر | VERIFIED |
| CHQ-02 | تاریخچه وضعیت (D,J,V,R,B,S,M,P,O) | `Check_Event` | PROVEN | فعال | MUST | A | وضعیت پایانی هر چک برابر؛ E08.3 | READER_READY |
| CHQ-03 | اسناد خودکار هر تغییر وضعیت | `Sanad_Type 0, SND_INDX J/V/M` | PROVEN | فعال | MUST | A | تطبیق 104/402 با سیستم چک | READER_READY |
| CHQ-04 | خرج چک به شخص ثالث و برگشت از خرج | `V با SarFasl, S` | PROVEN | فعال | MUST | A | برابر | DESIGNED |
| CHQ-05 | عودت/Undo وضعیت چک | `Process EC «عودت…»` | PROVEN | فعال | MUST | C | جایگزین: رویداد معکوس (نه حذف تاریخچه) | DESIGNED |
| CHQ-06 | پرچم‌های وضعیت در جدول Check | `Vosool, DarJaryan, …` | PROVEN | — | NO | C | فقط از رویدادها مشتق شود | READER_READY |
| CHQ-07 | چک ضمانت/امانی | `TAZMIN + 001/002` | PROVEN | فعال | MUST | A | برابر | DESIGNED |
| CHQ-08 | گزارش چک دریافتی/پرداختی، لیست چک‌ها | `گزارش هلو` | PROVEN | فعال | MUST | A | برابر | TODO |
| CHQ-09 | چک‌های افتتاحیه از سال قبل | `SND_INDX A (Sanad 1)` | PROVEN | فعال | MUST | A | برابر | READER_READY |

## مالیات

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| TAX-01 | ارسال به سامانه مؤدیان و وضعیت | `FACTURE.StateTax/FTaxId/UId/SerialFact, TaxLog` | PROVEN | 20,608 ارسال | MUST | B | وضعیت هر فاکتور برابر؛ تطبیق دفاتر↔مؤدیان | READER_READY |
| TAX-02 | ابطال در مؤدیان | `TaxLog SendType 3` | PROVEN | 4 | MUST | B | هم‌زمان با سند معکوس | READER_READY |
| TAX-03 | مالیات بر ارزش افزوده روی فاکتور | `Sum_Levy/Sum_Scot/Levy/Scot` | PROVEN | صفر | MUST | D | نیاز به تصمیم مالیاتی (قیمت شامل مالیات؟) | TODO |

## سوابق

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| AUD-01 | Log عملیات کاربران با متن فارسی | `Process` | PROVEN | فعال | MUST | B | همه ردیف‌ها Import؛ ترمیم Mojibake | READER_READY |
| AUD-02 | تصویر سند در هر عملیات (After-image؛ Blob ADTG) — بازیابی نسخه‌ها و اسناد حذف‌شده | `Process.Blob` | PROVEN | فعال | MUST | B | Parser ADTG؛ 161,163 ردیف تاریخی؛ آخرین تصویر = سند فعلی (97%) | READER_READY |
| AUD-04 | Payload خام وب‌سرویس (JSON invoiceinfo) | `Process.WEBBLOB` | PROVEN | فعال | MUST | B | R-10a/b/c؛ تطبیق روزانه وب↔دفتر | READER_READY |
| AUD-03 | گزارش کلی عملیات سیستم | `گزارش هلو` | PROVEN | کم | MUST | B | — | TODO |

## امنیت

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | کاربران و ۲۱۱ مجوز | `USERDB` | PROVEN | فعال | MUST | C | جایگزین: RBAC + احراز هویت امن؛ نگاشت مجوزهای کلیدی | DESIGNED |
| SEC-02 | کاربر سرپرست و کاربر وب‌سرویس | `USERDB.SuperVizor, User 3` | PROVEN | فعال | MUST | C | جایگزین: حساب سرویس با حداقل دسترسی | READER_READY |

## سیستم

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| SYS-01 | تنظیمات برنامه (Key-Value) | `MSETUP/MSETUP2/MSETUP3` | PROVEN | فعال | SHOULD | C | فقط تنظیمات مؤثر بر داده Import شوند | TODO |
| SYS-02 | پشتیبان‌گیری (محلی/DropBox) و ثبت آن | `BackInfo, Log A7` | PROVEN | فعال | MUST | B | — | TODO |
| SYS-03 | سال مالی = دیتابیس جدا (OldYear) | `نام DB holoo1_1404، مسیر OldYear` | PROVEN | فعال | MUST | C | جایگزین: چندساله در یک پایگاه + قفل سال؛ Reader چند Backup | DESIGNED |
| SYS-04 | طراحی چاپ فاکتور/چک/برچسب | `PRN_FACT, CHK_TARH, SETPRINT, LABEL, Set_TncRep` | PROVEN | فعال | SHOULD | C | قالب‌های چاپ جدید | TODO |
| SYS-05 | ماژول‌های بدون داده (تولید، امانی، طلا، اجاره، رستوران، گارانتی) | `FAC_BILD, AB_CATCH, Gold*, VC_Facture, Res_*, Kh_*` | PROVEN | استفاده نشده | NO | D | فقط Reader آماده شناسایی باشد | TODO |
