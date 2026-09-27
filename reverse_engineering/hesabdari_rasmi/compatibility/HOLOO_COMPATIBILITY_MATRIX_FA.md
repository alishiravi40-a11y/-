# Holoo Compatibility Matrix — حسابداری رسمی الماس شهر

> منبع اصلی: `compatibility/build_matrix.py` (ویرایش فقط در آن فایل) → `holoo_compatibility_matrix.csv` و همین صفحه.
> این ماتریس معیار پذیرش نرم‌افزار جدید است: هیچ ردیف `MUST` نباید بدون تصمیم ثبت‌شده حذف شود.

## خلاصه

| دسته | تعداد |
|---|---:|
| A — حفظ عین منطق | 32 |
| B — حفظ با طراحی بهتر | 31 |
| C — جایگزین مدرن | 25 |
| D — نیازمند تصمیم/اطلاعات | 7 |

| نیاز | تعداد |
|---|---:|
| MUST | 75 |
| SHOULD | 11 |
| OPTIONAL | 6 |
| NO | 3 |

| وضعیت آینده | تعداد |
|---|---:|
| VERIFIED | 26 |
| READER_READY | 25 |
| TODO | 25 |
| DESIGNED | 11 |
| IMPLEMENTED | 8 |

## حسابداری

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| ACC-01 | کدینگ سه‌سطحی کل/معین/تفصیلی | `SARFASL(Col,Moien,Tafzili,Sarfasl_Code,Parent,SParent)` | PROVEN | 33,564 حساب | MUST | B | همه کدها و نام‌ها و درخت پس از Import برابر؛ تعداد هر سطح | READER_READY |
| ACC-02 | حساب شخص در سطح معین (کدینگ ترکیبی قدیمی) | `CUSTOMER.*_Bed/_Bes → SARFASL (len 7)` | PROVEN | 9,977 شخص | MUST | B | D-03 ✅: شخص = بُعد فرعی روی حساب کنترلی (1030008… / 103P / 401P)؛ انتقال ۳۲,۷۰۵ حساب شخص؛ مانده هر شخص = View هلو (صفر اختلاف) | VERIFIED |
| ACC-03 | ماهیت حساب، گروه ترازنامه/سود و زیان | `SARFASL.Mahiat, Group → GROP_SAR` | PROVEN | همه حساب‌ها | MUST | A | ترازنامه و سود و زیان بازسازی‌شده = سند بستن هلو | READER_READY |
| ACC-04 | نقش سیستمی حساب‌ها (حساب پیش‌فرض عملیات) | `SarfaslType(59), SARFASL.Type, MSETUP2 Sar*` | PROVEN | فعال | MUST | B | هر نقش به همان حساب نگاشت شود | READER_READY |
| ACC-05 | سند و ردیف سند (بدهکار/بستانکار) | `SANAD, SND_LIST` | PROVEN | 47,447 سند / 190,469 ردیف | MUST | A | انتقال کامل ۴۷,۴۴۷ سند ۱۴۰۴ به هسته با قواعد توازن/برگ/شخص؛ برابری کامل (migration/) | VERIFIED |
| ACC-06 | شماره ثابت + شماره عطف (بازشماره‌گذاری به ترتیب تاریخ) | `SANAD.Sanad_Code, Sanad_Code_C/_C2` | PROVEN | فعال | MUST | B | هر دو شماره حفظ؛ ترتیب عطف = ترتیب تاریخ | READER_READY |
| ACC-07 | انواع سند (فروش/خرید/دستی/دریافت/پرداخت/انتقال/چک/کارمزد) | `SANAD.Sanad_Type` | PROVEN | فعال | MUST | A | توزیع انواع و الگوی حساب هر نوع برابر | READER_READY |
| ACC-08 | نوع ردیف (F/S/Z/خالی) برای ارتباط ردیف با فاکتور و تسویه | `SND_LIST.Type_Line` | PROVEN | فعال | MUST | B | Type_Line هر ردیف حفظ و به نقش معنایی نگاشت | READER_READY |
| ACC-09 | ردیف خارج از دفتر (Show_Daftar=0) — سازوکار ابطال فاکتور | `SND_LIST.Show_Daftar` | PROVEN | 14 ردیف | MUST | C | Reader: ردیف‌های پنهان خارج از دفتر؛ سیستم جدید: سند معکوس به‌جای پنهان‌سازی | READER_READY |
| ACC-10 | افتتاحیه/بستن موقت/اختتامیه | `SANAD.sanad_state 1/2/3؛ حساب 005/006` | PROVEN | فعال | MUST | B | سند بستن بازتولیدشده = سند هلو؛ همه حساب‌ها پس از اختتامیه صفر (R-07) | VERIFIED |
| ACC-11 | موجودی ادواری و COGS در بستن سال | `اسناد بستن + ARTICLE.Exist×Buy_Price` | PROVEN | فعال | MUST | B | COGS=7,699,284,125,059 بازتولید شود | VERIFIED |
| ACC-12 | مانده حساب (دفتر کل/معین/تفصیلی) | `MandehOfSarfasl, W_SarfaslMandeh` | PROVEN | گزارش پرکاربرد | MUST | A | مانده ۱۰,۰۳۸ کد (کل/معین/تفصیلی) در هسته جدید = View هلو MandehOfSarfasl (صفر اختلاف) | VERIFIED |
| ACC-13 | Cache مانده حساب | `SARFASL.Mandeh` | PROVEN | فعال | NO | C | جایگزین: محاسبه/Materialized view با کنترل | DESIGNED |
| ACC-14 | نسخه‌های سند افتتاحیه | `Sanad_Edit, snd_list_Edit` | PROVEN | 12 | MUST | B | همه نسخه‌ها Import و قابل مقایسه | READER_READY |
| ACC-15 | دفتر روزنامه، دفتر معین، مرور حساب | `گزارش‌های هلو (Log A4)؛ تابع Calc_BedBes_UseInFuncDateBetween2` | PROVEN | 143+13+8 اجرا | MUST | A | P-05: گردش ماهانه بدهکار/بستانکار همه اشخاص = تابع خود هلو (31,588 مقدار، صفر اختلاف)؛ View analytics.trial_balance_4col | VERIFIED |
| ACC-16 | ترازنامه آزمایشی ۲/۴/۶/۸ ستونی | `گزارش هلو (محاسبه در برنامه، نه در DB)` | PROVEN | 13 اجرا | MUST | A | analytics.trial_balance_4col؛ مانده پایان = P-01 (View هلو)؛ گردش دوره اشخاص = P-05؛ خروجی چاپی هلو برای مقایسه کامل لازم است | READER_READY |
| ACC-17 | مرکز هزینه | `SND_LIST.MHaz_Code` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| ACC-18 | ارز | `SND_LIST.Bed_Arz/ArzId, MONEY` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| ACC-19 | حساب‌های انتظامی (چک ضمانت) | `001/002, TAZMIN` | PROVEN | 399 چک | MUST | A | مانده انتظامی = جمع TAZMIN باز | DESIGNED |
| ACC-20 | کارتابل/تأیید/قطعی‌سازی سند | `SANAD.End_Save, Review, StateSanadForKartabl` | PROVEN | استفاده نشده | MUST | C | جایگزین: چرخه پیش‌نویس→ثبت→قطعی + قفل دوره/سال با مجوز period.close/period.reopen، علت و Audit (D-05)؛ core test_d05_* | IMPLEMENTED |
| ACC-21 | کنترل پنجره زمانی ثبت سند برای کاربر | `USERDB.InsSanadBefor/SanadTimeInsertValueBefore, EnterPriorDate` | NEEDS_MORE_EVIDENCE | 5 کاربر | MUST | C | جایگزین: ثبت در هر دوره باز (D-05) + قفل دوره با مجوز و Audit؛ core test_d05_* | IMPLEMENTED |

## اشخاص

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| PER-01 | پرونده شخص (حقیقی/حقوقی، کد ملی، اقتصادی، آدرس، موبایل) | `CUSTOMER, Cust_Tell, FactOther` | PROVEN | 32,696 شخص | MUST | B | همه فیلدهای پرکاربرد Import و برابر؛ نگاشت به core.party با party_legacy_code (Idempotent، ۳۲,۶۹۶ شخص) | IMPLEMENTED |
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
| SAL-03 | سند خودکار فروش با ردیف‌های دریافت همان لحظه | `Sanad_Type 13` | PROVEN | همه | MUST | B | قاعده ثبت core.document_posting_lines: ۱۹,۸۷۷/۱۹,۸۷۷ سند فروش عیناً برابر سند هلو (migration/posting_parity.py) | VERIFIED |
| SAL-04 | ثبت فروش از وب‌سرویس + شماره سفارش در شرح | `Process (وب سرویس)، Fac_Comment «…/شماره»، UserCode=3` | PROVEN | 20,083 | MUST | B | شماره سفارش استخراج و یکتا؛ تطبیق با سامانه فروش | READER_READY |
| SAL-05 | ابطال فاکتور فروش | `Fac_Type Q + SND_LIST.Show_Daftar=0 + TaxLog SendType 3` | PROVEN | 4 | MUST | C | جایگزین: ابطال با سند معکوس خودکار + مؤدیان | READER_READY |
| SAL-06 | برگشت از فروش | `Fac_Type Y؛ سند 14` | PROVEN | 5 | MUST | B | برگشت از فروش: ۵/۵ سند عیناً برابر هلو | VERIFIED |
| SAL-07 | فاکتور اشانتیون (مبلغ صفر) | `F با Sum_Price=0` | PROVEN | 4 | SHOULD | B | — | TODO |
| SAL-08 | تخفیف ردیف/فاکتور، پورسانت، واسطه | `DarsadTakhfif, Takhfif, DarsadPorsant, Vaseteh_Code` | PROVEN | استفاده نشده | OPTIONAL | D | — | TODO |
| SAL-09 | سطوح قیمت فروش (۱۰۰ سطح) و ArticlePrice | `ARTICLE.Sel_Price1..100, ArticlePrice` | NEEDS_MORE_EVIDENCE | کم | SHOULD | C | جایگزین: فهرست قیمت نسخه‌دار | TODO |
| SAL-10 | پیش‌فاکتور | `FBAILPRE/ABAILPRE (P)` | PROVEN | 8 | OPTIONAL | D | — | TODO |
| SAL-11 | حاشیه سود ردیف (بهای میانگین در ردیف) | `FACTART.Buy_Price` | PROVEN | فعال | MUST | C | جایگزین: بازمحاسبه بها پس از ثبت عقب‌افتاده | DESIGNED |
| SAL-12 | گزارش فاکتور ستونی/تیتر/خلاصه | `گزارش هلو` | PROVEN | پرکاربردترین | MUST | A | خروجی ماه نمونه برابر | TODO |
| SAL-14 | تطبیق سند کانال فروش/خرید وب با سند هلو | `WEBBLOB ↔ FACTURE/FACTART` | PROVEN | فعال | MUST | C | R-10a؛ جایگزین: منبع حقیقت واحد + تطبیق | READER_READY |
| SAL-13 | بالاترین فروش به اشخاص/کالاها | `گزارش هلو` | PROVEN | فعال | MUST | A | رتبه‌بندی برابر | TODO |
| SAL-15 | دو معیار قیمت خرید روی ردیف فروش (میانگین متحرک / آخرین خرید) و کنترل فروش زیر قیمت خرید | `FACTART.Buy_Price, FACTART.EndBuy_PriceK؛ MSETUP2 CheckBuyPriceAlart/CalcSoodInForooshEndBuyPrice` | PROVEN | هشدار هلو خاموش؛ 8,200 ردیف زیر آخرین خرید مدل | MUST | B | D-11: مبنا=آخرین قیمت خرید؛ D-12: هشدار یکتا برای هر فاکتور + ایمیل؛ D-13: آخرین خرید همان مدل در کل مجموعه (8,200 ردیف؛ 72 بی‌مبنا)؛ core test_alerts | IMPLEMENTED |
| SAL-16 | فروش اقساطی بتا (مشتری، قرارداد، قسط، وصول بانکی) | `SARFASL 1080004/4050006، GHEST (۲۲ ردیف)، شرح «وصول قسط بتا»` | PROVEN | ۳۹۷ مشتری؛ ۶۳.۵ میلیارد مانده | MUST | C | core 004_beta + beta/ (۳۱ آزمون)؛ اجرای آزمایشی: ۹۸.۹٪ شناسایی شخص از صورت‌حساب؛ ثبت حسابداری منتظر D-14 | IMPLEMENTED |

## خرید

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| PUR-01 | فاکتور خرید | `FACTURE/FACTART K؛ سند 14` | PROVEN | 942 | MUST | A | قاعده ثبت: ۹۴۲/۹۴۲ سند خرید عیناً برابر سند هلو | VERIFIED |
| PUR-02 | برگشت از خرید | `X؛ سند 13` | PROVEN | 1 | MUST | A | قاعده ثبت: ۱/۱ برگشت از خرید عیناً برابر سند هلو | VERIFIED |
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
| TRE-01 | صندوق‌ها و تنخواه (درختی) با حساب چک صندوق | `Cash(Sarfasl_Code, Sarfasl_Code2)` | PROVEN | 5 صندوق | MUST | A | ۸ صندوق در core.cashbox با حساب نقد و حساب چک صندوق (Sarfasl_Code2)؛ مقصد چک دریافتی در برابری E18 | VERIFIED |
| TRE-02 | حساب‌های بانکی، POS، درگاه، شبا، کارمزد | `ACOUND_N, NEWBANK` | PROVEN | فعال | MUST | B | ۹۸ حساب بانکی با حساب وصولی (Dar_*)، اسناد پرداختنی (Par_*) و کارمزد (Wage_*) — Reader v0.3؛ ۳۰۲ کارمزد همه روی حساب کارمزد تعریف‌شده همان بانک | VERIFIED |
| TRE-03 | دریافت (کارت/نقد/چک) و رسید | `سند 4/8/20, SaveResid` | PROVEN | فعال | MUST | B | قاعده core.treasury_posting_lines (دریافت + کارمزد + تخفیف نقدی): ۲,۲۵۰ سند دریافت هلو عیناً برابر (E19) | VERIFIED |
| TRE-04 | پرداخت | `سند 5` | PROVEN | فعال | MUST | A | ۲۷۲ سند پرداخت عیناً برابر، از جمله پرداخت با تخفیف نقدی خرید (E19) | VERIFIED |
| TRE-05 | انتقال بین بانک‌ها / واریز POS | `سند 1` | PROVEN | فعال | MUST | A | ۴,۷۳۴ سند انتقال عیناً برابر؛ انتقال چندمبدأ به چند سند انتقال تفکیک می‌شود (E19) | VERIFIED |
| TRE-06 | کارمزد بانکی | `سند 7/20 → 6010009` | PROVEN | فعال | MUST | A | ۲۱۰ سند کارمزد + کارمزد داخل انتقال‌ها عیناً برابر؛ ۱۸ سند نوع ۷ که کارمزد نیستند (W-33) با نوع درست ثبت می‌شوند | VERIFIED |
| TRE-07 | تسویه فاکتور نسیه (تخصیص دریافت به فاکتور) | `— (وجود ندارد)` | PROVEN | ندارد | MUST | C | قابلیت جدید: تخصیص FIFO/دستی + سن‌بندی | DESIGNED |
| TRE-08 | ریز عملکرد بانک | `گزارش هلو` | PROVEN | فعال | MUST | A | برابر | TODO |
| TRE-09 | اقساط | `GHEST` | PROVEN | کم | OPTIONAL | D | — | TODO |

## چک

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| CHQ-01 | چک دریافتی/پرداختی با بانک، شعبه، شماره، صیاد، صاحب | `Check, Check_Bkup` | PROVEN | فعال | MUST | B | همه چک‌ها و مبالغ برابر | VERIFIED |
| CHQ-02 | تاریخچه وضعیت (D,J,V,R,B,S,M,P,O) | `Check_Event` | PROVEN | فعال | MUST | A | ۳۵,۶۱۴ رویداد با مکان صریح از/به (core.cheque_event)؛ زنجیره مکان در پایگاه اجبار می‌شود (E18) | VERIFIED |
| CHQ-03 | اسناد خودکار هر تغییر وضعیت | `Sanad_Type 0, SND_INDX J/V/M` | PROVEN | فعال | MUST | A | سند هر رویداد = بد «به» / بس «از»: ۶,۲۲۹ از ۶,۲۳۰ سند چک هلو عیناً برابر؛ تنها استثنا دریافت تاریخ‌گذشته (W-34) که مدل جدید رد می‌کند | VERIFIED |
| CHQ-04 | خرج چک به شخص ثالث و برگشت از خرج | `V با SarFasl, S` | PROVEN | فعال | MUST | A | ۹۵۳ خرج و ۴۷۹ برگشت از خرج با طرف صریح؛ «۰۰۰۰۰» ممنوع (W-32) | VERIFIED |
| CHQ-05 | عودت/Undo وضعیت چک | `Process EC «عودت…»` | PROVEN | فعال | MUST | C | جایگزین: رویداد معکوس (نه حذف تاریخچه) | DESIGNED |
| CHQ-06 | پرچم‌های وضعیت در جدول Check | `Vosool, DarJaryan, …` | PROVEN | — | NO | C | مکان و وضعیت فقط از رویدادها مشتق می‌شود (core.cheque_location) | IMPLEMENTED |
| CHQ-07 | چک ضمانت/امانی | `TAZMIN + 001/002` | PROVEN | فعال | MUST | A | دفتر چک ضمانت (core.guarantee_instrument) با ضامن الزامی: ۲۷۲ سند انتظامی عیناً برابر در سطح حساب (W-35) | VERIFIED |
| CHQ-08 | گزارش چک دریافتی/پرداختی، لیست چک‌ها | `گزارش هلو` | PROVEN | فعال | MUST | A | برابر | TODO |
| CHQ-09 | چک‌های افتتاحیه از سال قبل | `SND_INDX A (Sanad 1)` | PROVEN | فعال | MUST | A | چک‌های افتتاحیه به‌عنوان موقعیت آغاز (از 005 به مکان) منتقل و برابر سند افتتاحیه هلو | VERIFIED |

## مالیات

| ID | قابلیت | منبع داده هلو | اثبات | کاربرد ۱۴۰۴ | نیاز | دسته | آزمون برابری | وضعیت |
|---|---|---|---|---|---|---|---|---|
| TAX-01 | ارسال به سامانه مؤدیان و وضعیت | `FACTURE.StateTax/FTaxId/UId/SerialFact, TaxLog` | PROVEN | 20,608 ارسال | MUST | B | وضعیت هر فاکتور برابر؛ تطبیق دفاتر↔مؤدیان | READER_READY |
| TAX-02 | ابطال در مؤدیان | `TaxLog SendType 3` | PROVEN | 4 | MUST | B | هم‌زمان با سند معکوس | READER_READY |
| TAX-03 | مالیات بر ارزش افزوده روی فاکتور | `Sum_Levy/Sum_Scot/Levy/Scot؛ MSETUP2 VAT/Darsad_Maliat/Darsad_Avarez` | PROVEN | صفر | MUST | A | D-01: رفتار هلو حفظ می‌شود (vat_mode=holoo_compatible؛ مقدار منبع ذخیره، بدون محاسبه حدسی)؛ core test_d01_* | IMPLEMENTED |

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
| SYS-03 | سال مالی = دیتابیس جدا (OldYear) | `نام DB holoo1_1404، مسیر OldYear` | PROVEN | فعال | MUST | C | جایگزین: چندساله در یک پایگاه با تفکیک کامل هر سال؛ چند سال هم‌زمان باز؛ سال جدید سال قبل را قفل نمی‌کند (D-05)؛ Reader چند Backup | IMPLEMENTED |
| SYS-04 | طراحی چاپ فاکتور/چک/برچسب | `PRN_FACT, CHK_TARH, SETPRINT, LABEL, Set_TncRep` | PROVEN | فعال | SHOULD | C | قالب‌های چاپ جدید | TODO |
| SYS-05 | ماژول‌های بدون داده (تولید، امانی، طلا، اجاره، رستوران، گارانتی) | `FAC_BILD, AB_CATCH, Gold*, VC_Facture, Res_*, Kh_*` | PROVEN | استفاده نشده | NO | D | فقط Reader آماده شناسایی باشد | TODO |
