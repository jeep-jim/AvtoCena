from pathlib import Path

p = Path("apps/web/lib/catalog/presentation.ts")
s = p.read_text()
marker = '  [/特斯拉/gi, "Tesla"],\n'
insert = '''  [/零跑汽车|零跑/g, "Leapmotor "],
  [/AITO\\s*问界|问界/g, "AITO "],
  [/智己汽车|智己/g, "IM Motors "],
  [/智界/g, "Luxeed "],
  [/享界/g, "Stelato "],
  [/尊界/g, "Maextro "],
  [/阿维塔/g, "Avatr "],
  [/深蓝汽车|深蓝/g, "Deepal "],
  [/岚图汽车|岚图/g, "Voyah "],
  [/吉利银河/g, "Geely Galaxy "],
  [/长安启源/g, "Changan Qiyuan "],
  [/ARCFOX极狐|极狐/g, "Arcfox "],
  [/广汽埃安|埃安/g, "GAC Aion "],
  [/广汽昊铂|昊铂/g, "Hyptec "],
  [/东风奕派/g, "Dongfeng eπ "],
  [/奇瑞风云/g, "Chery Fulwin "],
  [/星途/g, "Exeed "],
  [/星纪元/g, "Exlantix "],
  [/猛士/g, "M-Hero "],
  [/奔腾/g, "Bestune "],
  [/别克/g, "Buick "],
  [/五菱汽车|五菱/g, "Wuling "],
  [/吉利雷达/g, "Radar "],
  [/领克/g, "Lynk & Co "],
  [/欧拉/g, "Ora "],
  [/魏牌/g, "Wey "],
  [/方程豹/g, "Fangchengbao "],
  [/仰望/g, "Yangwang "],
  [/宝骏/g, "Baojun "],
  [/荣威/g, "Roewe "],
  [/名爵/g, "MG "],
  [/极石/g, "Rox "],
  [/东风纳米/g, "Dongfeng Nammi "],
  [/东风风神/g, "Dongfeng Aeolus "],
  [/启辰/g, "Venucia "],
  [/广汽传祺/g, "GAC Trumpchi "],
  [/一汽奔腾/g, "Bestune "],
  [/普拉多/g, "Prado "],
  [/汉兰达/g, "Highlander "],
  [/皇冠陆放/g, "Crown Kluger "],
  [/锋兰达/g, "Frontlander "],
  [/威兰达/g, "Wildlander "],
  [/RAV4荣放|荣放/g, "RAV4 "],
  [/兰德酷路泽/g, "Land Cruiser "],
  [/赛那/g, "Sienna "],
  [/格瑞维亚/g, "Granvia "],
  [/飞度/g, "Fit "],
  [/缤智/g, "Vezel "],
  [/奥德赛/g, "Odyssey "],
  [/途观L/g, "Tiguan L "],
  [/途昂/g, "Teramont "],
  [/迈腾/g, "Magotan "],
  [/探岳/g, "Tayron "],
  [/速腾/g, "Sagitar "],
  [/朗逸/g, "Lavida "],
  [/宝来/g, "Bora "],
  [/高尔夫/g, "Golf "],
  [/凌渡/g, "Lamando "],
  [/途岳/g, "Tharu "],
  [/([357])系/g, "$1 Series "],
'''

if '[/零跑汽车|零跑/g, "Leapmotor "]' not in s:
    if marker not in s:
        raise SystemExit("presentation marker not found")
    s = s.replace(marker, marker + insert, 1)
    p.write_text(s)

for required in ["Leapmotor", "IM Motors", "Exlantix", "Prado", "Tiguan L"]:
    if required not in p.read_text():
        raise SystemExit(f"missing alias: {required}")
print("china_public_labels_patch_ok")
