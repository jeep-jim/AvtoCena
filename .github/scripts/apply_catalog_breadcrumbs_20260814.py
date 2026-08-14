from pathlib import Path

page = Path('apps/web/app/(public)/cars/page.tsx')
s = page.read_text()

anchor = 'function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }\n'
insert = '''function numeric(value?: string | string[]) { const result = Number(first(value)); return Number.isFinite(result) && result > 0 ? result : undefined; }\n\nfunction catalogBreadcrumbHref(filters: { market?: string; make?: string; model?: string }) {\n  const query = new URLSearchParams();\n  if (filters.market) query.set("market", filters.market);\n  if (filters.make) query.set("make", filters.make);\n  if (filters.model) query.set("model", filters.model);\n  const suffix = query.toString();\n  return suffix ? `/cars?${suffix}` : "/cars";\n}\n'''
if anchor not in s:
    raise SystemExit('numeric anchor not found')
s = s.replace(anchor, insert, 1)

anchor = '  const japanStatisticsSelected = selectedMarket === "japan";\n\n  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#0f172a] text-white">\n'
insert = '''  const japanStatisticsSelected = selectedMarket === "japan";\n  const selectedMake = common.make;\n  const selectedModel = common.model;\n  const selectedMarketLabel = marketOrder.find((item) => item.id === selectedMarket)?.label || selectedMarket;\n  const hasCatalogContext = Boolean(selectedMarket || selectedMake || selectedModel);\n  const breadcrumbItems: Array<{ label: string; href: string }> = [\n    { label: "Главная", href: "/" },\n    { label: hasCatalogContext ? "Каталог" : "Каталог автомобилей", href: "/cars" },\n  ];\n  if (selectedMarket) breadcrumbItems.push({ label: selectedMarketLabel, href: catalogBreadcrumbHref({ market: selectedMarket }) });\n  if (selectedMake) breadcrumbItems.push({ label: selectedMake, href: catalogBreadcrumbHref({ market: selectedMarket, make: selectedMake }) });\n  if (selectedModel) breadcrumbItems.push({ label: selectedModel, href: catalogBreadcrumbHref({ market: selectedMarket, make: selectedMake, model: selectedModel }) });\n  const breadcrumbJsonLd = JSON.stringify({\n    "@context": "https://schema.org",\n    "@type": "BreadcrumbList",\n    itemListElement: breadcrumbItems.map((item, index) => ({\n      "@type": "ListItem",\n      position: index + 1,\n      name: item.label,\n      item: `https://avtocena.com${item.href}`,\n    })),\n  }).replace(/</g, "\\\\u003c");\n\n  return <main className="ac-catalog-page ac-page-copy min-h-screen bg-[#0f172a] text-white">\n'''
if anchor not in s:
    raise SystemExit('breadcrumb data anchor not found')
s = s.replace(anchor, insert, 1)

anchor = '''    <PublicHeader backHref="/" backLabel="На главную" />\n    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">\n      <div className="max-w-4xl">\n        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{japanStatisticsSelected ? "Аукционная статистика Японии" : "Каталог автомобилей"}</h1>\n'''
insert = '''    <PublicHeader backHref="/" backLabel="На главную" />\n    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: breadcrumbJsonLd }} />\n    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10">\n      <div className="max-w-4xl">\n        <nav aria-label="Хлебные крошки" className="ac-catalog-breadcrumbs ac-hide-scrollbar -mx-1 mb-4 flex min-w-0 items-center gap-x-2 overflow-x-auto whitespace-nowrap px-1 pb-1 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--ac-muted)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:mb-5 md:overflow-visible md:text-xs">\n          {breadcrumbItems.map((item, index) => <span key={`${item.href}-${item.label}`} className="flex shrink-0 items-center gap-x-2">\n            {index > 0 ? <span aria-hidden="true">/</span> : null}\n            {index === breadcrumbItems.length - 1 ? <span aria-current="page">{item.label}</span> : <Link href={item.href} className="transition hover:text-red-500">{item.label}</Link>}\n          </span>)}\n        </nav>\n        <h1 className="whitespace-nowrap text-[30px] font-black leading-none tracking-[-0.04em] sm:text-4xl md:text-6xl">{japanStatisticsSelected ? "Аукционная статистика Японии" : "Каталог автомобилей"}</h1>\n'''
if anchor not in s:
    raise SystemExit('catalog heading anchor not found')
s = s.replace(anchor, insert, 1)

page.write_text(s)
