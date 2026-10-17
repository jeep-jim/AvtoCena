import fs from "node:fs/promises";
import { parseAutohomeExactConfigFields } from "../apps/web/lib/catalog/autohome-new-exact-source";

async function main() {
  const specId = "77258";
  const url = `https://car.autohome.com.cn/config/spec/${specId}.html`;
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
      referer: `https://www.autohome.com.cn/spec/${specId}/`,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let markup = "";
  try { markup = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { markup = new TextDecoder("gb18030").decode(bytes); }
  if (!response.ok) throw new Error(`autohome_power_canary_http_${response.status}`);
  const fields = parseAutohomeExactConfigFields(markup, specId);
  const problems: string[] = [];
  if (!fields) problems.push("config_parse_null");
  if (fields?.engineMaxHp !== "167") problems.push(`engine_hp_${fields?.engineMaxHp || "missing"}`);
  if (fields?.engineMaxKw !== "123") problems.push(`engine_kw_${fields?.engineMaxKw || "missing"}`);
  if (fields?.overallMaxKw !== "440") problems.push(`overall_kw_${fields?.overallMaxKw || "missing"}`);
  if (fields?.motorTotalHp !== "435") problems.push(`motor_total_hp_${fields?.motorTotalHp || "missing"}`);
  if (fields?.motorTotalKw !== "320") problems.push(`motor_total_kw_${fields?.motorTotalKw || "missing"}`);
  if (fields?.systemHp !== "598") problems.push(`system_hp_${fields?.systemHp || "missing"}`);
  if (fields?.systemKw !== "440") problems.push(`system_kw_${fields?.systemKw || "missing"}`);
  const report = { status: response.status, bytes: markup.length, specId, fields, problems };
  await fs.writeFile("autohome-new-exact-power-canary.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (problems.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
