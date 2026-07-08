import fs from "node:fs";
import path from "node:path";

export function getDataRoot() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "data"),
    path.join(cwd, "..", "..", "data"),
    path.join(cwd, "..", "data"),
    path.join(process.cwd(), "apps", "web", "..", "..", "data")
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  return found ?? path.join(cwd, "data");
}

export function readDataJson<T>(relativePath: string, fallback: T): T {
  try {
    const filePath = path.join(getDataRoot(), relativePath);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function writeDataJson(relativePath: string, value: unknown) {
  const filePath = path.join(getDataRoot(), relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export function appendDataJson<T extends { id?: string }>(relativePath: string, item: T) {
  const list = readDataJson<T[]>(relativePath, []);
  const next = [{ ...item }, ...list];
  writeDataJson(relativePath, next);
  return next[0];
}
