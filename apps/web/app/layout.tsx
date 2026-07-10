import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://avtocena.com"),
  title: "АвтоЦена — авто под ваш бюджет за 30 секунд",
  description: "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ в России.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      {
        url: "/favicon.svg?v=4",
        type: "image/svg+xml",
        sizes: "any",
      },
      {
        url: "/favicon-dark.svg?v=4",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-light.svg?v=4",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicon.ico?v=4",
        sizes: "any",
      },
    ],
    apple: [
      {
        url: "/apple-touch-icon-dark.png?v=4",
        sizes: "180x180",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/apple-touch-icon-light.png?v=4",
        sizes: "180x180",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/apple-touch-icon.png?v=4",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#07080d" }
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
