import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  metadataBase: new URL("https://avtocena.com"),
  title: "АвтоЦена — авто под ваш бюджет за 30 секунд",
  description: "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.",
  manifest: "/manifest.json",
  applicationName: "АвтоЦена",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "АвтоЦена",
  },
  icons: {
    icon: [
      {
        url: "/favicon-dark.svg?v=5",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-light.svg?v=5",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicon.svg?v=5",
        type: "image/svg+xml",
        sizes: "any",
      },
    ],
    shortcut: "/favicon.ico?v=5",
    apple: [
      {
        url: "/apple-touch-icon-dark.png?v=5",
        sizes: "180x180",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/apple-touch-icon-light.png?v=5",
        sizes: "180x180",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/apple-touch-icon.png?v=5",
        sizes: "180x180",
      },
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
  themeColor: "#07080d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        <Script id="telegram-mini-app-colors" strategy="afterInteractive">
          {`(function () {
            function applyTelegramColors() {
              var tg = window.Telegram && window.Telegram.WebApp;
              if (!tg) return;
              try {
                tg.setHeaderColor('#07080d');
                tg.setBackgroundColor('#07080d');
                if (typeof tg.setBottomBarColor === 'function') {
                  tg.setBottomBarColor('#07080d');
                }
                tg.expand();
              } catch (error) {}
            }
            applyTelegramColors();
            window.setTimeout(applyTelegramColors, 250);
          })();`}
        </Script>
      </body>
    </html>
  );
}
