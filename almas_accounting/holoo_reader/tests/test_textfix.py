from holoo_reader import textfix


def test_repairs_cp1256_mojibake():
    broken = "عنوان حساب".encode("cp1256").decode("latin-1")
    assert textfix.looks_mojibake(broken)
    assert textfix.repair_mojibake(broken) == "عنوان حساب"


def test_leaves_valid_persian_and_latin_untouched():
    for s in ["گزارش فاكتور به‌صورت ستوني", "Samsung A16/128G", "web", "", None]:
        assert textfix.repair_mojibake(s) == s


def test_search_key_folds_arabic_letters_and_digits():
    assert textfix.search_key("علي كريمي ۱۲۳") == textfix.search_key("علی کریمی 123")


def test_web_order_number():
    assert textfix.web_order_number("webخانم پيماني انبار/217842") == "217842"
    assert textfix.web_order_number("زهرا رحيمي/10021806") == "10021806"
    assert textfix.web_order_number("گوشي مربوط به فاکتور") is None
