import https from "node:https";
import dns from "node:dns/promises";
import sharp from "sharp";
const MAX = 8 * 1024 * 1024;
export function isPublicIPv4(ip: string) {
  const n = ip.split(".").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
    return false;
  const [a, b] = n;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function downloadDealerImage(
  raw: string,
  redirects = 0,
): Promise<Buffer> {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    redirects > 3
  )
    throw Error("Нужна прямая HTTPS-ссылка на изображение");
  const addresses = await dns.lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !isPublicIPv4(a.address)))
    throw Error("Этот адрес недоступен для загрузки");
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        family: 4,
        lookup: ((_host: any, _options: any, cb: any) =>
          cb(null, addresses[0].address, 4)) as any,
        headers: {
          "User-Agent": "AvtoCena-DealerMedia/1.0",
          Accept: "image/*",
        },
      },
      (res) => {
        if (
          [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
          res.headers.location
        ) {
          res.resume();
          downloadDealerImage(
            new URL(res.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (
          res.statusCode !== 200 ||
          Number(res.headers["content-length"] || 0) > MAX
        ) {
          res.destroy();
          reject(Error("Не удалось скачать изображение до 8 МБ"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX) {
            res.destroy(Error("Изображение больше 8 МБ"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(Error("Сайт с изображением не ответил вовремя")),
      12000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
}
export async function prepareDealerImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX)
    throw Error("Размер изображения — до 8 МБ");
  const input = sharp(bytes, { limitInputPixels: 40000000 });
  const meta = await input.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || ""))
    throw Error("Выберите JPG, PNG или WebP");
  return input
    .rotate()
    .resize({
      width: 2400,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();
}
