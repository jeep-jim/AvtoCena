import "./globals.css";
import "./catalog-ui.css";
import "./public-polish.css";
import type { Metadata, Viewport } from "next";
import { RoutePreloader } from "@/components/layout/RoutePreloader";
import { PublicUiEnhancer } from "@/components/layout/PublicUiEnhancer";

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
.ac-page-copy [class*="text-red-300"],
.ac-page-copy [class*="text-red-200"] { color: var(--ac-public-accent) !important; }
html[data-theme="light"] .ac-page-copy .ac-on-image,
html[data-theme="light"] .ac-page-copy .ac-on-image *,
html[data-theme="light"] .ac-page-copy .ac-on-image [class~="text-white"],
html[data-theme="light"] .ac-page-copy .ac-on-image [class*="text-white/"] { color: #ffffff !important; }
.ac-body-picker-panel { position: relative !important; inset: auto !important; }

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
html[data-theme="light"] .ac-offer-breakdown,
html[data-theme="light"] .ac-offer-status {
  box-shadow: 0 10px 26px rgba(41,47,61,.09) !important;
}
html[data-theme="light"] .ac-offer-form {
  box-shadow: 0 16px 34px rgba(41,47,61,.10) !important;
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
        <PublicUiEnhancer />
        <RoutePreloader />
      </body>
    </html>
  );
}
