import "./globals.css";
import "./catalog-ui.css";
import "./public-polish.css";
import type { Metadata, Viewport } from "next";
import { RoutePreloader } from "@/components/layout/RoutePreloader";
import { PublicUiEnhancer } from "@/components/layout/PublicUiEnhancer";
import { PublicLegalFooter } from "@/components/layout/PublicLegalFooter";

export const metadata: Metadata = {
  metadataBase: new URL("https://avtocena.com"),
  title: "АвтоЦена — авто под ваш бюджет за 30 секунд",
  description: "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-light.svg", media: "(prefers-color-scheme: dark)" },
      { url: "/favicon-dark.svg", media: "(prefers-color-scheme: light)" },
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: "/apple-touch-icon-light.png", media: "(prefers-color-scheme: dark)" },
      { url: "/apple-touch-icon-dark.png", media: "(prefers-color-scheme: light)" },
    ],
  },
  openGraph: {
    title: "АвтоЦена",
    description: "Авто под ваш бюджет за 30 секунд",
    url: "https://avtocena.com",
    siteName: "АвтоЦена",
    locale: "ru_RU",
    type: "website"
  }
};

export const viewport: Viewport = {
  themeColor: "#e31b23",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('avtocena_theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
    var link = document.querySelector('link[data-avtocena-theme-icon]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-avtocena-theme-icon', 'true');
      document.head.appendChild(link);
    }
    link.href = theme === 'light' ? '/favicon-dark.svg' : '/favicon-light.svg';
  } catch (_) {}
})();
`;

const publicUiCorrections = `
:root {
  --ac-public-accent: #ff4650;
  --ac-surface: #12151d;
  --ac-surface-2: #20242e;
  --ac-surface-3: #282d38;
}
html[data-theme="light"] {
  --ac-public-accent: #c91e2a;
  --ac-surface: #f7f8fb;
  --ac-surface-2: #e4e8ef;
  --ac-surface-3: #d9dfe8;
}

/* Public navigation remains visible on every page and the page keeps its 64px offset. */
.ac-page-copy { padding-top: 4rem !important; }
.ac-public-header {
  position: fixed !important;
  inset: 0 0 auto 0 !important;
  z-index: 5000 !important;
  width: 100% !important;
}

.ac-page-copy [class*="text-red-300"],
.ac-page-copy [class*="text-red-200"] { color: var(--ac-public-accent) !important; }
html[data-theme="light"] .ac-page-copy .ac-on-image,
html[data-theme="light"] .ac-page-copy .ac-on-image *,
html[data-theme="light"] .ac-page-copy .ac-on-image [class~="text-white"],
html[data-theme="light"] .ac-page-copy .ac-on-image [class*="text-white/"] { color: #ffffff !important; }

/* Native arrows are one icon only. Theme background shorthands must not tile the SVG. */
.ac-native-select {
  background-repeat: no-repeat !important;
  background-position: right 15px center !important;
  background-size: 18px 18px !important;
}
html[data-theme="light"] .ac-native-select {
  background-color: var(--ac-surface-2) !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18' fill='none'%3E%3Cpath d='M5 7L9 11L13 7' stroke='%232b303b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right 15px center !important;
  background-size: 18px 18px !important;
}

/* Keep the whole calculator above the client gallery while the body menu is open. */
.ac-filter-panel {
  position: relative !important;
  z-index: 620 !important;
  overflow: visible !important;
}
.ac-body-picker-panel {
  position: absolute !important;
  inset: calc(100% + 8px) 0 auto 0 !important;
  z-index: 700 !important;
  margin: 0 !important;
  max-height: min(430px, 58vh) !important;
  overflow-y: auto !important;
  border: 0 !important;
  outline: 0 !important;
}
.ac-body-picker-panel button[class*="bg-red-500"] {
  background: #ff353d !important;
  color: #ffffff !important;
}
.ac-body-picker-panel button[class*="bg-red-500"] svg,
.ac-body-picker-panel button[class*="bg-red-500"] span {
  color: #ffffff !important;
  opacity: 1 !important;
}
html[data-theme="light"] .ac-body-picker-panel {
  background: #20242d !important;
  color: #ffffff !important;
  box-shadow: 0 24px 70px rgba(24,28,38,.28) !important;
}

/* Search fields stay readable and the caret/chevrons remain visible in both themes. */
.ac-search-menu input { caret-color: #ff4650 !important; }
.ac-custom-search-option { color: #ff6b73 !important; }
html[data-theme="light"] .ac-search-select,
html[data-theme="light"] .ac-search-select > span,
html[data-theme="light"] .ac-search-select svg { color: #171a21 !important; }

/* Live price movement added to the homepage cards. */
.ac-live-price-trend {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding-bottom: 2px;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: -.02em;
}
.ac-live-price-trend.is-down { color: #31b853 !important; }
.ac-live-price-trend.is-up { color: #ef3340 !important; }

/* Red actions use one solid brand red everywhere — no gradients and no red glow. */
.avto-button,
.avto-button:hover,
.avto-button:focus-visible,
.avto-button:active,
button[class*="bg-red-"],
a[class*="bg-red-"],
button[class*="from-red-"],
a[class*="from-red-"],
.ac-mobile-drawer a[href="/login"] {
  background: #ff353d !important;
  background-color: #ff353d !important;
  background-image: none !important;
  box-shadow: none !important;
  filter: none !important;
}

/* Cards are separated by surface, spacing and soft shadow — never by a 1px outline. */
.glass,
.ac-filter-panel,
.ac-result-summary,
.ac-offer-panel,
.ac-offer-spec-tile,
.ac-offer-breakdown,
.ac-offer-price-panel,
.ac-offer-status,
.ac-offer-form,
.ac-catalog-card,
.ac-favorites-card,
.ac-partner-modal,
.ac-partner-page section.relative.overflow-hidden {
  border: 0 !important;
  outline: 0 !important;
}
.ac-partner-page [class*="border-white/"],
.ac-partner-page [class*="border-red-"],
.ac-partner-page [class*="border-amber-"],
.ac-partner-page [class*="border-emerald-"] {
  border-width: 0 !important;
  border-color: transparent !important;
  outline: 0 !important;
}

.ac-offer-spec-tile,
.ac-offer-breakdown,
.ac-offer-status {
  background: var(--ac-surface-2) !important;
  box-shadow: 0 10px 28px rgba(0,0,0,.12) !important;
}
.ac-offer-form {
  background: var(--ac-surface) !important;
  box-shadow: 0 16px 38px rgba(0,0,0,.16) !important;
}
html[data-theme="light"] .ac-offer-spec-tile,
html[data-theme="light"] .ac-offer-status {
  background: #e7ebf2 !important;
  box-shadow: 0 10px 26px rgba(41,47,61,.09) !important;
}
html[data-theme="light"] .ac-offer-breakdown,
html[data-theme="light"] .ac-offer-form {
  background: #f7f8fb !important;
  box-shadow: 0 16px 34px rgba(41,47,61,.10) !important;
}
html[data-theme="light"] .ac-catalog-card > a > div:last-child span[class*="bg-white/"] {
  background: #dfe4ec !important;
  color: #465061 !important;
}

/* Footer navigation supports discovery while the compact legal row stays on one line on desktop. */
.ac-public-legal-footer { color: rgba(255,255,255,.58); }
.ac-public-footer-navigation { border-top: 1px solid rgba(255,255,255,.14); }
.ac-public-legal-footer-line { border-top: 1px solid rgba(255,255,255,.14); }
.ac-public-footer-nav-link {
  color: rgba(255,255,255,.62);
  transition: color .18s ease, transform .18s ease;
}
.ac-public-footer-nav-link:hover {
  color: #ff5962;
  transform: translateX(2px);
}
.ac-public-footer-cta {
  background: rgba(255,53,61,.13) !important;
  color: #ff6870;
  box-shadow: none !important;
}
.ac-public-footer-cta:hover {
  background: #ff353d !important;
  color: #ffffff;
}
.ac-public-legal-link {
  appearance: none;
  border: 0;
  padding: 0;
  background: transparent !important;
  color: rgba(255,255,255,.7);
  box-shadow: none !important;
  cursor: pointer;
  transition: color .18s ease, opacity .18s ease;
}
.ac-public-legal-link:hover { color: #ff4650; }
html[data-theme="light"] .ac-public-legal-footer { color: #687286; }
html[data-theme="light"] .ac-public-footer-navigation,
html[data-theme="light"] .ac-public-legal-footer-line { border-top-color: rgba(42,49,63,.18); }
html[data-theme="light"] .ac-public-footer-nav-link { color: #626d81; }
html[data-theme="light"] .ac-public-footer-nav-link:hover { color: #c91e2a; }
html[data-theme="light"] .ac-public-footer-cta {
  background: #f3e1e3 !important;
  color: #c91e2a;
}
html[data-theme="light"] .ac-public-footer-cta:hover {
  background: #ff353d !important;
  color: #ffffff;
}
html[data-theme="light"] .ac-public-legal-link { color: #4d586d; }
html[data-theme="light"] .ac-public-legal-link:hover { color: #c91e2a; }

/* Keep the price summary readable on desktop instead of splitting the currency sign. */
.ac-result-summary h1 {
  white-space: nowrap !important;
  word-break: normal !important;
  overflow-wrap: normal !important;
  font-size: clamp(2.2rem,3.1vw,3.45rem) !important;
}
@media (min-width: 1280px) {
  .ac-result-summary > div {
    grid-template-columns: minmax(310px,.9fr) minmax(0,1.65fr) 250px !important;
  }
}
@media (max-width: 639px) {
  .ac-result-summary h1 {
    white-space: normal !important;
    font-size: 2.25rem !important;
  }
  .ac-body-picker-panel {
    max-height: min(410px,62vh) !important;
  }
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <style dangerouslySetInnerHTML={{ __html: publicUiCorrections }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <PublicLegalFooter />
        <PublicUiEnhancer />
        <RoutePreloader />
      </body>
    </html>
  );
}
