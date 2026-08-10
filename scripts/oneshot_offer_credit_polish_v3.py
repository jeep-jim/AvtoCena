from pathlib import Path

p = Path("apps/web/components/catalog/OfferContactActions.tsx")
text = p.read_text(encoding="utf-8")

old = '<button type="button" aria-disabled="true" className="min-w-[176px] cursor-default rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black text-white">Подобрать кредит</button>'
new = '<button type="button" aria-disabled="true" className="ac-credit-partner-button min-w-[176px] cursor-default rounded-xl bg-[#111318] px-4 py-2.5 text-xs font-black !text-white">Подобрать кредит</button>'
if old not in text:
    raise RuntimeError("desktop credit button anchor changed")
text = text.replace(old, new, 1)

mileage_rule = '''          .ac-offer-page .ac-offer-detail-stack > div:first-child > .ac-offer-spec-tile[aria-label^="Пробег:"] {
            grid-column: span 2 !important;
            order: 3;
          }
'''
fallback_rule = mileage_rule + '''          .ac-offer-page .ac-offer-detail-stack > div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"])) > .ac-offer-spec-tile[aria-label^="Год:"],
          .ac-offer-page .ac-offer-detail-stack > div:first-child:not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"])) > .ac-offer-spec-tile[aria-label^="Двигатель:"] {
            grid-column: span 3 !important;
          }
'''
if ':not(:has(.ac-offer-spec-tile[aria-label^="Пробег:"]))' not in text:
    if mileage_rule not in text:
        raise RuntimeError("mileage desktop rule anchor changed")
    text = text.replace(mileage_rule, fallback_rule, 1)

old_mobile = '''          .ac-mobile-credit-button {
            display: flex;
            width: 100%;
            height: 46px;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(255,255,255,.08);
            border-radius: .9rem;
            background: #0b0d11;
            color: #fff !important;
'''
new_mobile = '''          .ac-mobile-credit-button {
            display: flex;
            width: 100%;
            height: 46px;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: .9rem;
            background: #0b0d11;
            color: #fff !important;
'''
if old_mobile not in text:
    raise RuntimeError("mobile credit button CSS anchor changed")
text = text.replace(old_mobile, new_mobile, 1)

style_anchor = '''        .ac-offer-contact-button {
          color: #fff !important;
        }
'''
style_new = style_anchor + '''        .ac-credit-partner-button {
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
        }
'''
if '.ac-credit-partner-button {' not in text:
    if style_anchor not in text:
        raise RuntimeError("credit button color CSS anchor changed")
    text = text.replace(style_anchor, style_new, 1)

p.write_text(text, encoding="utf-8")
