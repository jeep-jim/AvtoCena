import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "АвтоЦена — расчёт авто под ваш бюджет за 30 секунд",
  description: "Узнайте, какой автомобиль можно привезти под ваш бюджет и сколько он будет стоить под ключ."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
