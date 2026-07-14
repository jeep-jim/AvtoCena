import "./globals.css";
import "./catalog-ui.css";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <RoutePreloader />
      </body>
    </html>
  );
}
