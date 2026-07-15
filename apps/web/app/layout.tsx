import "./globals.css";
import "./catalog-ui.css";
import "./public-polish.css";
import type { Metadata, Viewport } from "next";
import { RoutePreloader } from "@/components/layout/RoutePreloader";

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
:root { --ac-public-accent: #ff4650; }
html[data-theme="light"] { --ac-public-accent: #c91e2a; }
.ac-page-copy [class*="text-red-300"],
.ac-page-copy [class*="text-red-200"] { color: var(--ac-public-accent) !important; }
html[data-theme="light"] .ac-page-copy .ac-on-image,
html[data-theme="light"] .ac-page-copy .ac-on-image *,
html[data-theme="light"] .ac-page-copy .ac-on-image [class~="text-white"],
html[data-theme="light"] .ac-page-copy .ac-on-image [class*="text-white/"] { color: #ffffff !important; }
.ac-body-picker-panel { position: relative !important; inset: auto !important; }
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
        <RoutePreloader />
      </body>
    </html>
  );
}
