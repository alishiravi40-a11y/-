import React, { useState, useEffect, useRef } from 'react';
import { Person, PersonRoleType, PersonStatusType, PersonAttachment, DocumentCategoryType } from '../types';
import { Edit2, UserPlus, X, User, Building2, Phone, CreditCard, FileText, Paperclip, Trash2, CheckCircle2, ShieldAlert, MapPin, Hash, Loader2 } from 'lucide-react';
import { isValidNationalId } from '../utils/validation';
import { toEnglishDigits } from '../utils/accounting';
import { compressImage } from '../utils/imageCompressor';
import { generateUniquePersonCode } from '../utils/codeGenerator';
import { PersonService } from '../services/personService';

interface PersonFormProps {
  initialPerson?: Person | null;
  initialNationalId?: string;
  onSave: (person: Partial<Person>, registerAmaniCheckSimultaneously: boolean) => void;
  onCancel: () => void;
  isCreditor?: boolean;
  isDebtor?: boolean;
  hideAmaniCheck?: boolean;
  existingPersons?: Person[];
  onSelectExistingPerson?: (person: Person) => void;
}

const ROLE_OPTIONS: { id: PersonRoleType; label: string; desc: string }[] = [
  { id: 'customer', label: 'مشتری', desc: 'خریدار کالا یا دریافت‌کننده خدمات' },
  { id: 'supplier', label: 'تأمین‌کننده', desc: 'فروشنده کالا یا ارائه‌دهنده خدمات' },
  { id: 'sales_rep', label: 'نماینده فروش', desc: 'بازاریاب و نماینده فروش استانی/شهری' },
  { id: 'credit_rep', label: 'نماینده اعتباری', desc: 'نماینده اعتباری سنجی و اقساط' },
  { id: 'employee', label: 'کارمند / پرسنل', desc: 'حقوق‌بگیر یا پرسنل مجموعه' },
  { id: 'other', label: 'سایر', desc: 'سایر طرف حساب‌ها' },
];

const PROVINCES_AND_CITIES: Record<string, string[]> = {
  'آذربایجان شرقی': ['تبریز', 'مراغه', 'مرند', 'میانه', 'اهر', 'بناب'],
  'آذربایجان غربی': ['ارومیه', 'خوی', 'میاندوآب', 'مهاباد', 'بوکان'],
  'اردبیل': ['اردبیل', 'پارس‌آباد', 'مشگین‌شهر', 'خلخال'],
  'اصفهان': ['اصفهان', 'کاشان', 'خمینی‌شهر', 'نجف‌آباد', 'شاهین‌شهر'],
  'البرز': ['کرج', 'هشتگرد', 'نظرآباد', 'محمدشهر'],
  'ایلام': ['ایلام', 'ایوان', 'دهلران', 'مهران'],
  'بوشهر': ['بوشهر', 'برازجان', 'بندر گناوه', 'خورموج'],
  'تهران': ['تهران', 'اسلام‌شهر', 'شهریار', 'قدس', 'ملارد', 'ری', 'پاکدشت', 'دماوند', 'فیروزکوه', 'ورامین'],
  'چهارمحال و بختیاری': ['شهرکرد', 'بروجن', 'لردگان', 'فارسان'],
  'خراسان جنوبی': ['بیرجند', 'قائن', 'فردوس', 'طبس'],
  'خراسان رضوی': ['مشهد', 'نیشابور', 'سبزوار', 'تربت حیدریه', 'کاشمر', 'قوچان'],
  'خراسان شمالی': ['بجنورد', 'شیروان', 'اسفراین', 'آشخانه'],
  'خوزستان': ['اهواز', 'دزفول', 'آبادان', 'خرمشهر', 'اندیمشک', 'ماهشهر', 'بهبهان', 'شوشتر'],
  'زنجان': ['زنجان', 'ابهر', 'خرمدره', 'قیدار'],
  'سمنان': ['سمنان', 'شاهرود', 'دامغان', 'گرمسار'],
  'سیستان و بلوچستان': ['زاهدان', 'زابل', 'ایرانشهر', 'چابهار', 'سراوان'],
  'فارس': ['شیراز', 'مرودشت', 'جهرم', 'فسا', 'کازرون', 'داراب', 'لارستان'],
  'قزوین': ['قزوین', 'الوند', 'تاکستان', 'آبیک'],
  'قم': ['قم'],
  'کردستان': ['سنندج', 'سقز', 'مریوان', 'بانه', 'قروه'],
  'کرمان': ['کرمان', 'سیرجان', 'رفسنجان', 'جیرفت', 'بم'],
  'کرمانشاه': ['کرمانشاه', 'اسلام‌آباد غرب', 'کنگاور', 'جوانرود'],
  'کهگیلویه و بویراحمد': ['یاسوج', 'دوگنبدان', 'دهدشت'],
  'گلستان': ['گرگان', 'گنبد کاووس', 'علی‌آباد کتول', 'بندر ترکمن'],
  'گیلان': ['رشت', 'بندر انزلی', 'لاهیجان', 'لنگرود', 'تالش', 'آستارا', 'فومن'],
  'لرستان': ['خرم‌آباد', 'بروجرد', 'دورود', 'کوهدشت', 'الیگودرز'],
  'مازندران': ['ساری', 'بابل', 'آمل', 'قائم‌شهر', 'بهشهر', 'چالوس', 'نوشهر', 'تنکابن', 'رامسر'],
  'مرکزی': ['اراک', 'ساوه', 'خمین', 'محلات'],
  'هرمزگان': ['بندرعباس', 'میناب', 'دهبارز', 'بندر لنگه', 'قشم', 'کیش'],
  'همدان': ['همدان', 'ملایر', 'نهاوند', 'تویسرکان'],
  'یزد': ['یزد', 'میبد', 'اردکان', 'بافق'],
};

function isJalaliLeapYear(year: number) {
  const remainders = [1, 5, 9, 13, 17, 22, 26, 30];
  return remainders.includes(year % 33);
}

const YEARS = Array.from({length: 106}, (_, i) => (1405 - i).toString());
const MONTHS = [
  { value: '1', label: 'فروردین' },
  { value: '2', label: 'اردیبهشت' },
  { value: '3', label: 'خرداد' },
  { value: '4', label: 'تیر' },
  { value: '5', label: 'مرداد' },
  { value: '6', label: 'شهریور' },
  { value: '7', label: 'مهر' },
  { value: '8', label: 'آبان' },
  { value: '9', label: 'آذر' },
  { value: '10', label: 'دی' },
  { value: '11', label: 'بهمن' },
  { value: '12', label: 'اسفند' },
];

export default function PersonForm({ 
  initialPerson, 
  initialNationalId,
  onSave, 
  onCancel, 
  isCreditor, 
  isDebtor,
  hideAmaniCheck,
  existingPersons = [],
  onSelectExistingPerson
}: PersonFormProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'identity' | 'roles_status' | 'contact' | 'banking' | 'internal' | 'documents'>('basic');
  
  // Basic info & Code
  const [personFormCode, setPersonFormCode] = useState('');
  const [isCodeReady, setIsCodeReady] = useState(false);
  const [personType, setPersonType] = useState<'real' | 'legal'>('real');
  const [personFormName, setPersonFormName] = useState('');
  const [personFormNationalId, setPersonFormNationalId] = useState('');

  // Identity Supplementary info
  const [personFormFatherName, setPersonFormFatherName] = useState('');
  const [personFormBirthDate, setPersonFormBirthDate] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthDay, setBirthDay] = useState('');
  const [personFormGender, setPersonFormGender] = useState<'male' | 'female' | 'other'>('male');
  const [personFormCompanyName, setPersonFormCompanyName] = useState('');

  // Roles & Status
  const [personFormRoles, setPersonFormRoles] = useState<PersonRoleType[]>([]);
  const [personFormStatus, setPersonFormStatus] = useState<PersonStatusType>('active');

  // Contact info & Address
  const [personFormMobile, setPersonFormMobile] = useState('');
  const [personFormPhone, setPersonFormPhone] = useState('');
  const [personFormProvince, setPersonFormProvince] = useState('');
  const [personFormCity, setPersonFormCity] = useState('');
  const [personFormDistrict, setPersonFormDistrict] = useState('');
  const [personFormAddress, setPersonFormAddress] = useState('');
  const [personFormPostalCode, setPersonFormPostalCode] = useState('');

  // Banking info
  const [personFormBankName, setPersonFormBankName] = useState('');
  const [personFormCardNumber, setPersonFormCardNumber] = useState('');
  const [personFormShebaNumber, setPersonFormShebaNumber] = useState('');
  const [personFormAccountHolderName, setPersonFormAccountHolderName] = useState('');

  // Internal Notes
  const [personFormInternalNotes, setPersonFormInternalNotes] = useState('');

  // Documents
  const [personFormAttachments, setPersonFormAttachments] = useState<PersonAttachment[]>([]);
  const [selectedDocCategory, setSelectedDocCategory] = useState<DocumentCategoryType>('national_card');
  const [isUploading, setIsUploading] = useState(false);

  // Amani check
  const [registerAmaniCheckSimultaneously, setRegisterAmaniCheckSimultaneously] = useState(false);

  // Duplicate Warning Modal
  const [duplicateMatch, setDuplicateMatch] = useState<{ person: Person; matchField: string } | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (initialPerson) {
      if (initialPerson.code) {
        setPersonFormCode(initialPerson.code);
        setIsCodeReady(true);
      } else {
        setIsCodeReady(false);
        const fallbackCode = generateUniquePersonCode(existingPersons);
        setPersonFormCode(fallbackCode);
        PersonService.getNextPersonCode()
          .then(code => {
            if (isMounted) {
              if (code) {
                setPersonFormCode(code);
              }
              setIsCodeReady(true);
            }
          })
          .catch(err => {
            console.warn('Failed to fetch next person code from server, keeping local generator fallback:', err);
            if (isMounted) {
              setIsCodeReady(true);
            }
          });
      }
      setPersonType(initialPerson.personType || (initialPerson.companyName ? 'legal' : 'real'));
      setPersonFormName(initialPerson.name || '');
      setPersonFormNationalId(initialPerson.nationalId || '');
      
      // Load Roles
      if (initialPerson.roles && initialPerson.roles.length > 0) {
        setPersonFormRoles(initialPerson.roles);
      } else if (initialPerson.role === 'creditor') {
        setPersonFormRoles(['supplier']);
      } else if (initialPerson.role === 'both') {
        setPersonFormRoles(['customer', 'supplier']);
      } else {
        setPersonFormRoles(['customer']);
      }

      setPersonFormStatus(initialPerson.status || 'active');
      setPersonFormMobile(initialPerson.mobile || '');
      setPersonFormPhone(initialPerson.phone || '');
      setPersonFormProvince(initialPerson.province || '');
      setPersonFormCity(initialPerson.city || '');
      setPersonFormDistrict(initialPerson.district || '');
      setPersonFormAddress(initialPerson.address || '');
      setPersonFormPostalCode(initialPerson.postalCode || '');

      setPersonFormFatherName(initialPerson.fatherName || '');
      setPersonFormBirthDate(initialPerson.birthDate || '');
      if (initialPerson.birthDate) {
        const [y, m, d] = initialPerson.birthDate.split('/');
        setBirthYear(y || '');
        setBirthMonth(m || '');
        setBirthDay(d || '');
      } else {
        setBirthYear('');
        setBirthMonth('');
        setBirthDay('');
      }
      setPersonFormGender(initialPerson.gender || 'male');
      setPersonFormCompanyName(initialPerson.companyName || '');
      setPersonFormInternalNotes(initialPerson.internalNotes || '');

      setPersonFormCardNumber(initialPerson.cardNumber || '');
      setPersonFormShebaNumber(initialPerson.shebaNumber || '');
      setPersonFormBankName(initialPerson.bankName || '');
      setPersonFormAccountHolderName(initialPerson.accountHolderName || initialPerson.name || '');

      setPersonFormAttachments(initialPerson.attachments || []);
    } else {
      setIsCodeReady(false);
      const fallbackCode = generateUniquePersonCode(existingPersons);
      setPersonFormCode(fallbackCode);
      PersonService.getNextPersonCode()
        .then(code => {
          if (isMounted) {
            if (code) {
              setPersonFormCode(code);
            }
            setIsCodeReady(true);
          }
        })
        .catch(err => {
          console.warn('Failed to fetch next person code from server, keeping local generator fallback:', err);
          if (isMounted) {
            setIsCodeReady(true);
          }
        });

      setPersonType('real');
      setPersonFormName('');
      setPersonFormNationalId(initialNationalId ? toEnglishDigits(initialNationalId).replace(/\D/g, '') : '');
      
      // Default roles
      if (isCreditor) {
        setPersonFormRoles(['supplier']);
      } else {
        setPersonFormRoles(['customer']);
      }

      setPersonFormStatus('active');
      setPersonFormMobile('');
      setPersonFormPhone('');
      setPersonFormProvince('');
      setPersonFormCity('');
      setPersonFormDistrict('');
      setPersonFormAddress('');
      setPersonFormPostalCode('');

      setPersonFormFatherName('');
      setPersonFormBirthDate('');
      setBirthYear('');
      setBirthMonth('');
      setBirthDay('');
      setPersonFormGender('male');
      setPersonFormCompanyName('');
      setPersonFormInternalNotes('');

      setPersonFormCardNumber('');
      setPersonFormShebaNumber('');
      setPersonFormBankName('');
      setPersonFormAccountHolderName('');

      setPersonFormAttachments([]);
    }
    return () => {
      isMounted = false;
    };
  }, [initialPerson, initialNationalId, isCreditor]);

  const daysInMonth = React.useMemo(() => {
    if (!birthMonth) return 31;
    const m = parseInt(birthMonth);
    if (m <= 6) return 31;
    if (m <= 11) return 30;
    if (!birthYear) return 30;
    const y = parseInt(birthYear);
    return isJalaliLeapYear(y) ? 30 : 29;
  }, [birthMonth, birthYear]);

  useEffect(() => {
    if (birthDay) {
      const d = parseInt(birthDay);
      if (d > daysInMonth) {
        setBirthDay(daysInMonth.toString());
      }
    }
  }, [daysInMonth, birthDay]);

  const toggleRole = (role: PersonRoleType) => {
    if (personFormRoles.includes(role)) {
      if (personFormRoles.length === 1) {
        alert('حداقل انتخاب یک نقش برای طرف حساب الزامی است.');
        return;
      }
      setPersonFormRoles(personFormRoles.filter(r => r !== role));
    } else {
      setPersonFormRoles([...personFormRoles, role]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      const file = files[0];
      let url = '';
      let fileSizeKb = Math.round(file.size / 1024);

      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file, { maxDimension: 1200, quality: 0.8 });
        url = compressed.compressedDataUrl;
        fileSizeKb = compressed.compressedSizeKb;
      } else {
        url = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (evt) => resolve(evt.target?.result as string || '');
          reader.readAsDataURL(file);
        });
      }

      const newAttachment: PersonAttachment = {
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: file.name,
        url: url,
        type: file.type,
        uploadDate: new Date().toLocaleDateString('fa-IR'),
        category: selectedDocCategory,
        status: 'approved',
        fileSizeKb
      };

      setPersonFormAttachments(prev => [...prev, newAttachment]);
    } catch (err) {
      console.error('Error uploading document:', err);
      alert('خطا در پردازش و بارگذاری تصویر/فایل مدارک.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setPersonFormAttachments(prev => prev.filter(att => att.id !== id));
  };

  const performDuplicateCheck = (cleanNatId: string, cleanMob: string) => {
    if (initialPerson?.id) return null; // If editing existing person, bypass duplicate check against itself

    // 1. Check National ID match
    if (cleanNatId) {
      const match = existingPersons.find(p => p.id !== initialPerson?.id && p.nationalId && toEnglishDigits(p.nationalId).replace(/\D/g, '') === cleanNatId);
      if (match) {
        return { person: match, matchField: 'کد ملی / شناسه ملی' };
      }
    }

    // 2. Check Mobile match
    if (cleanMob && cleanMob.length >= 10) {
      const match = existingPersons.find(p => p.id !== initialPerson?.id && p.mobile && toEnglishDigits(p.mobile).replace(/\D/g, '') === cleanMob);
      if (match) {
        return { person: match, matchField: 'شماره تلفن همراه' };
      }
    }

    return null;
  };

  const executeSave = () => {
    const cleanNatId = personFormNationalId.trim();
    const cleanMob = personFormMobile.trim();
    const fullBirthDate = (birthYear && birthMonth && birthDay) ? `${birthYear}/${birthMonth.padStart(2, '0')}/${birthDay.padStart(2, '0')}` : personFormBirthDate;

    // Map roles to legacy role field for full backward compatibility
    let legacyRole: 'debtor' | 'creditor' | 'both' = 'debtor';
    const isSupp = personFormRoles.includes('supplier');
    const isCust = personFormRoles.includes('customer');
    if (isSupp && isCust) legacyRole = 'both';
    else if (isSupp) legacyRole = 'creditor';

    onSave({
      code: personFormCode || generateUniquePersonCode(existingPersons),
      personType,
      name: personFormName.trim(),
      nationalId: cleanNatId || undefined,
      mobile: cleanMob,
      phone: personFormPhone.trim() || undefined,
      province: personFormProvince.trim() || undefined,
      city: personFormCity.trim() || undefined,
      district: personFormDistrict.trim() || undefined,
      address: personFormAddress.trim() || undefined,
      postalCode: personFormPostalCode.trim() || undefined,
      roles: personFormRoles,
      status: personFormStatus,
      fatherName: personFormFatherName.trim() || undefined,
      birthDate: fullBirthDate.trim() || undefined,
      gender: personType === 'real' ? personFormGender : undefined,
      companyName: personFormCompanyName.trim() || undefined,
      cardNumber: personFormCardNumber.trim() || undefined,
      shebaNumber: personFormShebaNumber.trim() || undefined,
      bankName: personFormBankName.trim() || undefined,
      accountHolderName: personFormAccountHolderName.trim() || undefined,
      internalNotes: personFormInternalNotes.trim() || undefined,
      attachments: personFormAttachments,
      role: legacyRole,
      updatedAt: new Date().toISOString(),
    }, registerAmaniCheckSimultaneously);

    setDuplicateMatch(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (!isCodeReady) {
      e.preventDefault();
      return;
    }
    e.preventDefault();

    // 1. Mandatory Name Validation
    if (!personFormName.trim()) {
      alert('وارد کردن نام و نام خانوادگی / نام مجموعه الزامی است.');
      setActiveTab('basic');
      return;
    }
    
    // 2. Mandatory Mobile Validation
    if (!personFormMobile.trim()) {
      alert('وارد کردن شماره تلفن همراه (اجباری) الزامی است.');
      setActiveTab('contact');
      return;
    }

    // Mobile digits length check
    const cleanMob = toEnglishDigits(personFormMobile).replace(/\D/g, '');
    if (cleanMob.length < 10) {
      alert('شماره تلفن همراه وارد شده معتبر نیست.');
      setActiveTab('contact');
      return;
    }

    // 3. National ID Validation if provided
    const cleanId = personFormNationalId.trim();
    if (cleanId) {
      if (personType === 'real' && !isValidNationalId(cleanId)) {
        alert('کد ملی وارد شده معتبر نیست.');
        setActiveTab('basic');
        return;
      }
    }

    // 4. Duplicate Check
    const dup = performDuplicateCheck(cleanId, cleanMob);
    if (dup) {
      setDuplicateMatch(dup);
      return;
    }

    executeSave();
  };

  const editingPerson = initialPerson;

  return (
    <div className="bg-white p-4 sm:p-5 rounded-3xl border border-zinc-200 shadow-lg relative max-w-2xl mx-auto my-2 text-right">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-zinc-100 pb-3 mb-4">
        <div className="flex items-center space-x-2 space-x-reverse">
          <div className="w-9 h-9 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center font-bold shadow-xs">
            <User size={20} />
          </div>
          <div>
            <div className="flex items-center space-x-2 space-x-reverse">
              <span className="font-sans text-sm font-bold text-zinc-900">
                {editingPerson ? `پرونده شخص: ${editingPerson.name}` : 'ایجاد پرونده شخص جدید'}
              </span>
              <span className="bg-zinc-100 text-zinc-600 text-[10px] px-2 py-0.5 rounded-lg font-mono font-bold flex items-center gap-1">
                <Hash size={10} />
                {personFormCode}
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 block mt-0.5">اطلاعات پایه شخص برای استفاده در بخشهای مختلف سیستم</span>
          </div>
        </div>
        <button 
          type="button"
          onClick={onCancel}
          className="text-zinc-400 hover:text-zinc-600 transition p-1.5 hover:bg-zinc-100 rounded-full"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto space-x-1 space-x-reverse border-b border-zinc-100 pb-2 mb-4 text-xs font-medium no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('basic')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'basic' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <User size={13} />
          <span>اطلاعات اصلی</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('identity')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'identity' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <Building2 size={13} />
          <span>هویتی و تکمیلی</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('contact')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'contact' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <Phone size={13} />
          <span>تماس و آدرس ⭐</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('roles_status')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'roles_status' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <CheckCircle2 size={13} />
          <span>نقش‌ها و وضعیت</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('banking')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'banking' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <CreditCard size={13} />
          <span>اطلاعات بانکی</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('internal')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'internal' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <FileText size={13} />
          <span>یادداشت مدیریت</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('documents')}
          className={`px-3 py-1.5 rounded-xl whitespace-nowrap transition flex items-center space-x-1 space-x-reverse ${activeTab === 'documents' ? 'bg-red-600 text-white shadow-xs font-bold' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          <Paperclip size={13} />
          <span>مدارک ({personFormAttachments.length})</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Tab 1: Basic Info */}
        {activeTab === 'basic' && (
          <div className="space-y-3 animate-fadeIn">
            {/* Person Type Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نوع شخص</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPersonType('real')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                    personType === 'real' ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  <User size={14} />
                  <span>شخص حقیقی</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPersonType('legal')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1.5 space-x-reverse ${
                    personType === 'legal' ? 'bg-zinc-900 text-white border-zinc-900 shadow-xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                  }`}
                >
                  <Building2 size={14} />
                  <span>شخص حقوقی / شرکت</span>
                </button>
              </div>
            </div>

            {/* Code & Name */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">کد شخص (تولید خودکار)</label>
                <input
                  type="text"
                  value={personFormCode}
                  readOnly
                  className="w-full bg-zinc-100 border border-zinc-200 rounded-xl px-3 py-2 font-mono text-xs text-zinc-600 text-center font-bold cursor-not-allowed"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                  {personType === 'real' ? 'نام و نام خانوادگی' : 'نام شرکت / مجموعه'} <span className="text-red-500">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  placeholder={personType === 'real' ? 'مثال: علی شیروی' : 'مثال: شرکت بازرگانی پارس'}
                  value={personFormName}
                  onChange={(e) => setPersonFormName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                  required
                />
              </div>
            </div>

            {/* National ID Step */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                  {personType === 'real' ? 'کد ملی (۱۰ رقم)' : 'شناسه ملی شرکت (۱۱ رقم)'}
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={personType === 'real' ? 10 : 11}
                  placeholder={personType === 'real' ? 'کد ملی ۱۰ رقمی' : 'شناسه ملی ۱۱ رقمی'}
                  value={personFormNationalId}
                  onChange={(e) => {
                    const val = toEnglishDigits(e.target.value).replace(/\D/g, '');
                    setPersonFormNationalId(val);
                  }}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono tracking-wider"
                />
                <span className="text-[10px] text-zinc-400 mt-0.5 block">کد / شناسه ملی جهت بررسی پرونده تکراری بررسی می‌شود.</span>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                  شماره تلفن همراه <span className="text-red-500">* (اجباری)</span>
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                  value={personFormMobile}
                  onChange={(e) => setPersonFormMobile(toEnglishDigits(e.target.value))}
                  className="w-full bg-amber-50/40 border border-amber-300 rounded-xl px-3 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono font-bold"
                  required
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Identity Supplementary Info */}
        {activeTab === 'identity' && (
          <div className="space-y-3 animate-fadeIn">
            {personType === 'real' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام پدر</label>
                    <input
                      type="text"
                      placeholder="نام پدر..."
                      value={personFormFatherName}
                      onChange={(e) => setPersonFormFatherName(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">تاریخ تولد</label>
                    <div className="flex space-x-1 space-x-reverse">
                      <select
                        value={birthDay}
                        onChange={(e) => setBirthDay(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center"
                      >
                        <option value="">روز</option>
                        {Array.from({length: daysInMonth}, (_, i) => i + 1).map(d => (
                          <option key={d} value={d.toString()}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={birthMonth}
                        onChange={(e) => setBirthMonth(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center"
                      >
                        <option value="">ماه</option>
                        {MONTHS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <select
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono"
                      >
                        <option value="">سال</option>
                        {YEARS.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-700 mb-1">جنسیت</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPersonFormGender('male')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition ${
                        personFormGender === 'male' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                      }`}
                    >
                      مرد
                    </button>
                    <button
                      type="button"
                      onClick={() => setPersonFormGender('female')}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition ${
                        personFormGender === 'female' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                      }`}
                    >
                      زن
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام شرکت / محل اشتغال (اختیاری)</label>
                  <input
                    type="text"
                    placeholder="مثال: فروشگاه شیروی"
                    value={personFormCompanyName}
                    onChange={(e) => setPersonFormCompanyName(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام ثبتی کامل شرکت / مجموعه</label>
                  <input
                    type="text"
                    placeholder="مثال: شرکت بازرگانی بین‌المللی پارس"
                    value={personFormCompanyName || personFormName}
                    onChange={(e) => {
                      setPersonFormCompanyName(e.target.value);
                      if (!personFormName) setPersonFormName(e.target.value);
                    }}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">تاریخ تأسیس</label>
                    <div className="flex space-x-1 space-x-reverse">
                      <select
                        value={birthDay}
                        onChange={(e) => setBirthDay(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center"
                      >
                        <option value="">روز</option>
                        {Array.from({length: daysInMonth}, (_, i) => i + 1).map(d => (
                          <option key={d} value={d.toString()}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={birthMonth}
                        onChange={(e) => setBirthMonth(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center"
                      >
                        <option value="">ماه</option>
                        {MONTHS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <select
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value)}
                        className="w-1/3 bg-zinc-50 border border-zinc-200 rounded-xl px-1 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono"
                      >
                        <option value="">سال</option>
                        {YEARS.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام نماینده / مدیرعامل</label>
                    <input
                      type="text"
                      placeholder="نام مدیر یا نماینده رسمی..."
                      value={personFormFatherName}
                      onChange={(e) => setPersonFormFatherName(e.target.value)}
                      className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab 3: Contact & Address */}
        {activeTab === 'contact' && (
          <div className="space-y-3 animate-fadeIn">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">تلفن ثابت (اختیاری)</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="۰۲۱۱۲۳۴۵۶۷۸"
                value={personFormPhone}
                onChange={(e) => setPersonFormPhone(toEnglishDigits(e.target.value))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono"
              />
            </div>

            {/* Address Section */}
            <div className="border-t border-zinc-100 pt-3 space-y-2">
              <span className="block text-[11px] font-bold text-zinc-800 flex items-center gap-1">
                <MapPin size={13} className="text-red-600" />
                آدرس پستی و محل سکونت / فعالیت
              </span>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-0.5">استان</label>
                  <input
                    type="text"
                    list="provinces-list"
                    placeholder="انتخاب یا تایپ استان"
                    value={personFormProvince}
                    onChange={(e) => {
                      setPersonFormProvince(e.target.value);
                      setPersonFormCity(''); // reset city when province changes
                    }}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                  />
                  <datalist id="provinces-list">
                    {Object.keys(PROVINCES_AND_CITIES).map(p => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-0.5">شهر</label>
                  <input
                    type="text"
                    list="cities-list"
                    placeholder={personFormProvince ? "انتخاب یا تایپ شهر" : "ابتدا استان را انتخاب کنید"}
                    value={personFormCity}
                    onChange={(e) => setPersonFormCity(e.target.value)}
                    disabled={!personFormProvince}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right disabled:opacity-50"
                  />
                  <datalist id="cities-list">
                    {personFormProvince && PROVINCES_AND_CITIES[personFormProvince]?.map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-0.5">منطقه / محله</label>
                  <input
                    type="text"
                    placeholder="مثال: بازار"
                    value={personFormDistrict}
                    onChange={(e) => setPersonFormDistrict(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-2.5 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none text-right"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">آدرس دقیق</label>
                <textarea
                  rows={2}
                  placeholder="خیابان، پلاک، طبقه، واحد..."
                  value={personFormAddress}
                  onChange={(e) => setPersonFormAddress(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right resize-none"
                />
              </div>

              <div>
                <label className="block text-[10px] text-zinc-500 mb-0.5">کد پستی (۱۰ رقمی)</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={10}
                  placeholder="۱۲۳۴۵۶۷۸۹۰"
                  value={personFormPostalCode}
                  onChange={(e) => setPersonFormPostalCode(toEnglishDigits(e.target.value).replace(/\D/g, ''))}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-1.5 font-sans text-xs text-zinc-800 focus:outline-none text-center font-mono tracking-wider"
                />
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Roles & Status */}
        {activeTab === 'roles_status' && (
          <div className="space-y-4 animate-fadeIn">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-2">نقش‌های چندگانه شخص در سیستم (امکان انتخاب همزمان چند نقش)</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_OPTIONS.map(opt => {
                  const isSelected = personFormRoles.includes(opt.id);
                  return (
                    <button
                      type="button"
                      key={opt.id}
                      onClick={() => toggleRole(opt.id)}
                      className={`p-2.5 rounded-xl border text-right transition flex flex-col justify-between ${
                        isSelected 
                          ? 'bg-red-50 border-red-300 text-red-900 shadow-xs' 
                          : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs">{opt.label}</span>
                        {isSelected && <CheckCircle2 size={14} className="text-red-600" />}
                      </div>
                      <span className="text-[10px] text-zinc-500 leading-tight">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-3">
              <label className="block text-[11px] font-semibold text-zinc-700 mb-2">وضعیت فعال‌بودن شخص</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPersonFormStatus('active')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1 space-x-reverse ${
                    personFormStatus === 'active' ? 'bg-emerald-500 text-white border-emerald-600 shadow-xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                  }`}
                >
                  <span>فعال</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPersonFormStatus('inactive')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1 space-x-reverse ${
                    personFormStatus === 'inactive' ? 'bg-amber-500 text-white border-amber-600 shadow-xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                  }`}
                >
                  <span>غیرفعال</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPersonFormStatus('blocked')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold transition flex items-center justify-center space-x-1 space-x-reverse ${
                    personFormStatus === 'blocked' ? 'bg-rose-600 text-white border-rose-700 shadow-xs' : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                  }`}
                >
                  <span>مسدود</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Banking Info */}
        {activeTab === 'banking' && (
          <div className="space-y-3 animate-fadeIn">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام بانک</label>
                <input
                  type="text"
                  placeholder="مثال: بانک ملی، بانک ملت..."
                  value={personFormBankName}
                  onChange={(e) => setPersonFormBankName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-zinc-700 mb-1">نام صاحب حساب</label>
                <input
                  type="text"
                  placeholder="نام و نام خانوادگی صاحب حساب..."
                  value={personFormAccountHolderName}
                  onChange={(e) => setPersonFormAccountHolderName(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">شماره کارت بانکی (۱۶ رقمی)</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={16}
                placeholder="۶۰۳۷۹۹۷۵۱۲۳۴۵۶۷۸"
                value={personFormCardNumber}
                onChange={(e) => setPersonFormCardNumber(toEnglishDigits(e.target.value).replace(/\D/g, ''))}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono tracking-wider"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">شماره شبا (IBAN)</label>
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="980170000000123456789001"
                  value={personFormShebaNumber}
                  onChange={(e) => setPersonFormShebaNumber(toEnglishDigits(e.target.value).toUpperCase())}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl pl-9 pr-3 py-2 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-center font-mono tracking-wider"
                />
                <span className="absolute left-3 text-xs font-bold text-zinc-400 font-mono">IR</span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 6: Internal Notes */}
        {activeTab === 'internal' && (
          <div className="space-y-3 animate-fadeIn">
            <div>
              <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                یادداشت و توضیحات داخلی (مخصوص مدیریت)
              </label>
              <p className="text-[10px] text-zinc-400 mb-2">ثبت سوابق مشتری، ملاحظات مدیریتی و شرایط خاص همکاری. این اطلاعات کاملاً محرمانه و داخلی است.</p>
              <textarea
                rows={5}
                placeholder="سوابق خریدهای قبلی، خوش‌حسابی، توضیحات اعتباری یا شروط ویژه..."
                value={personFormInternalNotes}
                onChange={(e) => setPersonFormInternalNotes(e.target.value)}
                className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 font-sans text-xs text-zinc-800 focus:outline-none focus:border-red-500 text-right resize-none"
              />
            </div>
          </div>
        )}

        {/* Tab 7: Documents */}
        {activeTab === 'documents' && (
          <div className="space-y-3 animate-fadeIn">
            <div className="bg-zinc-50 p-3 rounded-2xl border border-zinc-200 space-y-2">
              <span className="block text-xs font-bold text-zinc-800">بارگذاری مدرک یا پیوست جدید</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">دسته مدارک</label>
                  <select
                    value={selectedDocCategory}
                    onChange={(e) => setSelectedDocCategory(e.target.value as DocumentCategoryType)}
                    className="w-full bg-white border border-zinc-200 rounded-xl px-2 py-1.5 text-xs text-zinc-800 focus:outline-none"
                  >
                    <option value="national_card">کارت ملی / شناسه</option>
                    <option value="birth_certificate">شناسنامه / اسناد ثبتی</option>
                    <option value="contract">قرارداد رسمی</option>
                    <option value="bank_cheque">تصویر چک امانی / صیادی</option>
                    <option value="business_license">جواز کسب / پروانه فعالیت</option>
                    <option value="guarantee_promissory">سفته ضمانت</option>
                    <option value="other">سایر مدارک</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-red-600 hover:bg-red-500 text-white py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1 space-x-reverse shadow-xs transition disabled:opacity-50"
                  >
                    <Paperclip size={14} />
                    <span>{isUploading ? 'در حال فشرده‌سازی...' : 'انتخاب تصویر / فایل'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Attachments List */}
            <div className="space-y-2">
              <span className="block text-[11px] font-semibold text-zinc-700">لیست پیوست‌های ثبت‌شده:</span>
              {personFormAttachments.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-zinc-200 rounded-2xl text-zinc-400 text-xs">
                  هیچ مدرکی بارگذاری نشده است.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {personFormAttachments.map(att => (
                    <div key={att.id} className="bg-white p-2 rounded-xl border border-zinc-200 flex items-center justify-between shadow-2xs">
                      <div className="flex items-center space-x-2 space-x-reverse overflow-hidden">
                        {att.url && att.type.startsWith('image/') ? (
                          <img src={att.url} alt={att.name} className="w-9 h-9 object-cover rounded-lg border border-zinc-100 flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 flex-shrink-0">
                            <FileText size={16} />
                          </div>
                        )}
                        <div className="truncate text-right">
                          <span className="block text-xs font-bold text-zinc-800 truncate">{att.name}</span>
                          <span className="text-[10px] text-zinc-400 block">{att.uploadDate} • {att.fileSizeKb ? `${att.fileSizeKb} KB` : ''}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded-lg transition"
                        title="حذف پیوست"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section: Optional Amani Check */}
        {!editingPerson && !hideAmaniCheck && (
          <div className="bg-rose-50/60 p-3 rounded-2xl border border-rose-100 mt-2">
            <label className="flex items-center space-x-2 space-x-reverse cursor-pointer">
              <input
                type="checkbox"
                checked={registerAmaniCheckSimultaneously}
                onChange={(e) => setRegisterAmaniCheckSimultaneously(e.target.checked)}
                className="w-4 h-4 text-rose-600 rounded border-rose-300 focus:ring-rose-500"
              />
              <div className="flex flex-col text-right">
                <span className="text-xs font-bold text-rose-800">ثبت چک امانی همزمان با ایجاد این طرف حساب</span>
                <span className="text-[10px] text-rose-600">بلافاصله پس از ذخیره، فرم ثبت دریافت چک امانی جهت تکمیل پرونده اعتباری باز می‌شود</span>
              </div>
            </label>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 space-x-reverse pt-2 border-t border-zinc-100">
          <button 
            type="submit" 
            disabled={!isCodeReady}
            className={`flex-1 py-2.5 rounded-xl flex items-center justify-center space-x-1.5 space-x-reverse font-sans text-xs font-bold shadow-xs transition ${
              !isCodeReady 
                ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' 
                : 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
            }`}
          >
            {!isCodeReady ? (
              <>
                <Loader2 size={15} className="animate-spin text-zinc-400" />
                <span>در حال دریافت کد شخص...</span>
              </>
            ) : (
              <>
                {editingPerson ? <Edit2 size={15} /> : <UserPlus size={15} />}
                <span>{editingPerson ? 'ذخیره تغییرات پرونده' : 'ایجاد پرونده شخص'}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-100 font-sans text-xs font-medium transition"
          >
            انصراف
          </button>
        </div>
      </form>

      {/* Duplicate Warning Modal Overlay */}
      {duplicateMatch && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-md w-full shadow-2xl border border-amber-200 animate-scaleUp text-right space-y-4">
            <div className="flex items-center space-x-2 space-x-reverse text-amber-600">
              <ShieldAlert size={26} className="text-amber-600 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-sm text-zinc-900">هشدار: احتمال وجود پرونده تکراری</h3>
                <span className="text-[11px] text-amber-700">انطباق بر اساس {duplicateMatch.matchField}</span>
              </div>
            </div>

            <div className="bg-amber-50/70 p-3 rounded-2xl border border-amber-200 text-xs text-zinc-800 space-y-1.5">
              <p className="font-semibold text-amber-900">مشخصات پرونده موجود در سیستم:</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-zinc-500">نام و نام خانوادگی:</span> <strong className="text-zinc-900">{duplicateMatch.person.name}</strong></div>
                <div><span className="text-zinc-500">کد شخص:</span> <strong className="text-zinc-900 font-mono">{duplicateMatch.person.code}</strong></div>
                <div><span className="text-zinc-500">کد / شناسه ملی:</span> <strong className="text-zinc-900 font-mono">{duplicateMatch.person.nationalId || '---'}</strong></div>
                <div><span className="text-zinc-500">موبایل:</span> <strong className="text-zinc-900 font-mono">{duplicateMatch.person.mobile || '---'}</strong></div>
                {duplicateMatch.person.companyName && (
                  <div className="col-span-2"><span className="text-zinc-500">مجموعه/شرکت:</span> <strong className="text-zinc-900">{duplicateMatch.person.companyName}</strong></div>
                )}
              </div>
            </div>

            <p className="text-xs text-zinc-600 leading-relaxed">
              جهت حفظ یکپارچگی اطلاعات پرونده‌ها و تفصیلی شناور حسابداری، از ایجاد رکوردهای تکراری خودداری کنید.
            </p>

            <div className="space-y-2 pt-1">
              {onSelectExistingPerson && (
                <button
                  type="button"
                  onClick={() => {
                    const matched = duplicateMatch.person;
                    setDuplicateMatch(null);
                    onSelectExistingPerson(matched);
                  }}
                  className="w-full bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-xs font-bold shadow-xs transition flex items-center justify-center space-x-1.5 space-x-reverse"
                >
                  <User size={14} />
                  <span>ورود به پرونده موجود</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setDuplicateMatch(null)}
                className="w-full bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-2.5 rounded-xl text-xs font-medium transition"
              >
                اصلاح اطلاعات وارد شده
              </button>

              <button
                type="button"
                onClick={() => {
                  setDuplicateMatch(null);
                  executeSave();
                }}
                className="w-full text-zinc-500 hover:text-zinc-700 py-1 text-[11px] font-medium transition text-center block underline"
              >
                ادامه ثبت فقط با تأیید کاربر
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
