import {execFileSync} from "node:child_process";
import {mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {getJsonStorage} from "../apps/web/lib/data";
import {encryptConfig, decryptConfig, type BrowserConfig, type Envelope} from "../apps/web/lib/browser-pilot/config";
import {callBrowser} from "../apps/web/lib/browser-pilot/worker";
const folder = "b1g9vq73onqb7dp5hgqg", name = "avtocena-browser-pilot";
const dir = mkdtempSync(join(tmpdir(), "browser-pilot-"));
const storage = getJsonStorage();
let createdId = "", activated = false;
function yc(args: string[]) {
 try {return JSON.parse(execFileSync(process.env.YC_BIN || "yc", [...args, "--folder-id", folder, "--format", "json"], {encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"]}));}
 catch (e: any) { const stderr = String(e.stderr || ""); const code = stderr.match(/(?:code = |code: )([A-Za-z_]+)/)?.[1] || "command_failed"; throw Error(`YC ${args.slice(0,3).join(" ")}: ${code}`); }
}
function summary(message: string) {console.log(message); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");}
async function main() {
 if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 20) throw Error("AUTH_SECRET_missing");
 if (!process.env.IMAGE || !/^cr\.yandex\/crp73he0q1blh1mujo4s\/avtocena-browser:[a-f0-9]{40}$/.test(process.env.IMAGE)) throw Error("invalid_image");
 const prior = await storage.readJson<Envelope | null>("browser-pilot/runtime.json", null);
 const instances = yc(["compute", "instance", "list"]) as any[];
 const existing = instances.filter(v => v.name === name);
 if (existing.length) {
  if (existing.length !== 1 || !prior) throw Error("existing_pilot_requires_review_no_duplicate_created");
  const config = decryptConfig(prior, process.env.AUTH_SECRET);
  if (config.instanceId !== existing[0].id || !config.enabled || config.expiresAt <= Date.now()) throw Error("existing_pilot_expired_or_disabled");
  const health = await callBrowser(config, {action: "health"}); if (health.status !== 200) throw Error("existing_pilot_unhealthy");
  summary(`Pilot already exists: ${existing[0].id}. No extra VM created. Worker release: ${config.releaseSha}.`); return;
 }
 if (prior) throw Error("stale_runtime_config_requires_review");
 const subnets = yc(["vpc", "subnet", "list"]) as any[];
 const subnet = subnets.find(v => v.zone_id === "ru-central1-a") || subnets.find(v => v.zone_id === "ru-central1-d");
 if (!subnet) throw Error("no_existing_subnet_in_supported_zone");
 summary(`Preflight: Compute and VPC readable. Zone ${subnet.zone_id}. Fixed pilot: one VM, 2 vCPU, 8 GiB, 30 GB disk, two sessions; no autoscaling.`);
 const groups = yc(["vpc", "security-group", "list"]) as any[];
 let group = groups.find(v => v.name === name && v.network_id === subnet.network_id);
 if (!group) group = yc(["vpc", "security-group", "create", "--name", name, "--network-id", subnet.network_id,
  "--rule", "direction=ingress,port=8443,protocol=tcp,v4-cidrs=0.0.0.0/0",
  "--rule", "direction=egress,protocol=any,v4-cidrs=0.0.0.0/0"]);
 const certPath = join(dir, "cert.pem"), keyPath = join(dir, "key.pem");
 execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "8", "-subj", "/CN=browser-pilot.internal", "-addext", "subjectAltName=DNS:browser-pilot.internal"], {stdio: "ignore"});
 const shared = randomBytes(48).toString("hex"), expiresAt = Date.now() + 7 * 86400000;
 console.log(`::add-mask::${shared}`);
 const workerEnv = `BROWSER_WORKER_KEY=${shared}\nRELEASE_SHA=${process.env.GITHUB_SHA}\nPILOT_EXPIRES_AT=${expiresAt}\n`;
 const startup = `#!/bin/bash
set -euo pipefail
# Metadata credentials stay on the host; browsers cannot contact metadata or private networks.
iptables -I DOCKER-USER -i docker0 -d 169.254.0.0/16 -j DROP
iptables -I DOCKER-USER -i docker0 -d 10.0.0.0/8 -j DROP
iptables -I DOCKER-USER -i docker0 -d 172.16.0.0/12 -j DROP
iptables -I DOCKER-USER -i docker0 -d 192.168.0.0/16 -j DROP
curl -fsS --max-time 10 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' | docker login --username iam --password-stdin cr.yandex >/dev/null
docker pull ${process.env.IMAGE}
docker logout cr.yandex >/dev/null
systemctl enable --now avtocena-browser.service
systemctl enable --now avtocena-browser-expiry.timer
`;
 const unit = `[Unit]
After=docker.service network-online.target
Requires=docker.service
[Service]
Restart=on-failure
RestartSec=5
ExecStart=/usr/bin/docker run --rm --init --name avtocena-browser --dns 77.88.8.8 --memory 6g --cpus 2 --pids-limit 512 --shm-size 512m --security-opt seccomp=/opt/avtocena-browser/seccomp.json --cap-drop ALL --cap-add SYS_CHROOT --read-only --tmpfs /tmp:rw,nosuid,size=536870912 --tmpfs /home/browser:rw,nosuid,uid=1001,gid=1001,size=16777216 -p 8443:8443 --env-file /opt/avtocena-browser/worker.env -v /opt/avtocena-browser/tls:/run/browser:ro ${process.env.IMAGE}
ExecStop=/usr/bin/docker stop -t 15 avtocena-browser
TimeoutStopSec=25
[Install]
WantedBy=multi-user.target
`;
 const write = (path: string, content: string, permissions = "0600", owner = "root:root") => ({path, content, permissions, owner});
 const cloud = {package_update: true, packages: ["docker.io", "python3", "curl"], write_files: [
  write("/opt/avtocena-browser/worker.env", workerEnv),
  write("/opt/avtocena-browser/tls/cert.pem", readFileSync(certPath,"utf8"), "0444"),
  write("/opt/avtocena-browser/tls/key.pem", readFileSync(keyPath,"utf8"), "0400", "1001:1001"),
  write("/opt/avtocena-browser/seccomp.json", readFileSync("services/browser-pilot/seccomp_profile.json","utf8"), "0444"),
  write("/opt/avtocena-browser/start.sh", startup, "0700"),
  write("/etc/systemd/system/avtocena-browser.service", unit, "0644"),
  write("/etc/systemd/system/avtocena-browser-expiry.service", "[Service]\nType=oneshot\nExecStart=/usr/sbin/poweroff\n", "0644"),
  write("/etc/systemd/system/avtocena-browser-expiry.timer", `[Timer]\nOnCalendar=${new Date(expiresAt).toISOString().replace("T"," ").slice(0,19)} UTC\nPersistent=true\n[Install]\nWantedBy=timers.target\n`, "0644")
 ], runcmd: [["systemctl","enable","--now","docker"], ["bash","/opt/avtocena-browser/start.sh"]]};
 const metadata = join(dir,"cloud-init.json"); writeFileSync(metadata,"#cloud-config\n"+JSON.stringify(cloud),{mode:0o600});
 const vm = yc(["compute","instance","create","--name",name,"--zone",subnet.zone_id,"--platform","standard-v3","--cores","2","--core-fraction","100","--memory","8GB","--service-account-id","ajekvv7ulcilmppf8qj3","--create-boot-disk","image-family=ubuntu-2204-lts,image-folder-id=standard-images,size=30,type=network-ssd,auto-delete=true","--network-interface",`subnet-id=${subnet.id},nat-ip-version=ipv4,security-group-ids=${group.id}`,"--metadata-from-file",`user-data=${metadata}`,"--labels","app=avtocena-browser,pilot=true"]);
 createdId = vm.id;
 const ip = vm.network_interfaces?.[0]?.primary_v4_address?.one_to_one_nat?.address;
 if (!ip) throw Error("pilot_public_ip_missing");
 const config: BrowserConfig = {enabled:true,url:`https://${ip}:8443/v1`,key:shared,ca:readFileSync(certPath,"utf8"),expiresAt,instanceId:vm.id,releaseSha:process.env.GITHUB_SHA!};
 summary(`Created pilot ${vm.id}; waiting for TLS worker health. Automatic VM shutdown: ${new Date(expiresAt).toISOString()}.`);
 let healthy = false;
 for(let i=0;i<48;i++) {try {const health=await callBrowser(config,{action:"health"});const body=JSON.parse(health.data.toString());if(health.status===200&&body.ok&&body.release===process.env.GITHUB_SHA){healthy=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,10000));}
 if(!healthy) throw Error("pilot_health_timeout_VM_will_be_stopped");
 // Publish only an encrypted envelope. No worker key, chat or screenshot in the bucket.
 await storage.writeJson("browser-pilot/runtime.json", encryptConfig(config,process.env.AUTH_SECRET), {ifNoneMatch:"*"});
 activated=true; summary(`Pilot enabled. Worker ${process.env.GITHUB_SHA}; max 2 sessions, 20s lease, 90s idle, 10min lifetime. No automatic renewal after 7 days.`);
}
main().catch(error=>{summary(String(error.message)); if(createdId&&!activated){try{yc(["compute","instance","stop","--id",createdId]);summary("Failed pilot VM stopped; disk remains for review.");}catch{summary(`ATTENTION: stop pilot VM ${createdId} in Yandex Cloud; automatic cleanup failed.`);}}process.exitCode=1;}).finally(()=>rmSync(dir,{recursive:true,force:true}));
