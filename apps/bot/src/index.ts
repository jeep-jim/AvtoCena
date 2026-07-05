import "dotenv/config";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.log("TELEGRAM_BOT_TOKEN is empty");
  process.exit(0);
}

const bot = new Telegraf(token);

bot.start((ctx) => {
  ctx.reply("АвтоЦена — расчёт авто под ваш бюджет за 30 секунд.", {
    reply_markup: {
      inline_keyboard: [[{ text: "Открыть АвтоЦену", web_app: { url: process.env.NEXT_PUBLIC_APP_URL || "https://avtocena.com" } }]]
    }
  });
});

bot.launch();
console.log("AvtoCena bot started");
