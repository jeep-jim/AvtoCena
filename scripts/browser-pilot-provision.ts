import {execFileSync} from "node:child_process";
import {mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes, randomUUID} from "node:crypto";
import {getJsonStorage} from "../apps/web/lib/data";
import {encryptConfig, decryptConfig, type BrowserConfig, type Envelope} from "../apps/web/lib/browser-pilot/config";
import {callBrowser} from "../apps/web/lib/browser-pilot/worker";
const folder = "b1g9vq73onqb7dp5hgqg", name = "avtocena-browser-pilot";
const dir = mkdtempSync(join(tmpdir(), "browser-pilot-"));
const storage = getJsonStorage();
let createdId = "", activated = false, attempted = false;
function yc(args: string[]) {
 try {const output = execFileSync(process.env.YC_BIN || "yc", [...args, "--folder-id", folder, "--format", "json"], {encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"]}); return output.trim() ? JSON.parse(output) : null;}
 catch (e: any) { const stderr = String(e.stderr || ""); const code = stderr.match(/(?:code = |code: )([A-Za-z_]+)/)?.[1] || "command_failed"; throw Error(`YC ${args.slice(0,3).join(" ")}: ${code}${(args[0] === "vpc" || (args[0] === "compute" && ["stop", "delete"].includes(args[2]))) ? ": " + stderr.slice(0, 2500) : ""}`); }
}
function summary(message: string) {console.log(message); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");}
async function main() {
 if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 20) throw Error("AUTH_SECRET_missing");
 if (!process.env.IMAGE || !/^cr\.yandex\/crp73he0q1blh1mujo4s\/avtocena-browser:[a-f0-9]{40}$/.test(process.env.IMAGE)) throw Error("invalid_image");
 const priorMeta = await storage.readJsonWithMeta<Envelope | null>("browser-pilot/runtime.json", null);
 let prior = priorMeta.value, replacementEtag: string | undefined, retainedExpiry: number | undefined;
 const instances = yc(["compute", "instance", "list"]) as any[];
 let existing = instances.filter(v => v.name === name);
 if (process.env.REPAIR_PILOT_ID) {
  if (existing.length !== 1 || !prior || !priorMeta.etag) throw Error("repair_requires_one_configured_pilot");
  const old = decryptConfig(prior, process.env.AUTH_SECRET), vm = existing[0];
  if (old.instanceId !== (process.env.REPAIR_CONFIG_INSTANCE_ID || process.env.REPAIR_PILOT_ID) || vm.id !== process.env.REPAIR_PILOT_ID || vm.labels?.app !== "avtocena-browser" || old.releaseSha !== process.env.REPAIR_RELEASE_SHA || old.expiresAt <= Date.now()) throw Error("repair_identity_guard");
  if(vm.status==="STOPPED" && !old.enabled && process.env.REPAIR_FAILED_RUN && vm.labels?.run===process.env.REPAIR_FAILED_RUN) {
   summary("Replacing the explicitly identified stopped diagnostic VM.");
   const metadata = yc(["compute","instance","get","--id",vm.id,"--full"]).metadata?.["user-data"];
   if (metadata) {
    const cloud = JSON.parse(metadata.replace(/^#cloud-config\s*/, ""));
    const firewall = cloud.write_files?.find((entry: any) => entry.path === "/opt/avtocena-browser/firewall.sh");
    if (firewall) summary("Previous non-secret firewall script: " + JSON.stringify(firewall.content));
   }
  } else {
   if(vm.id!==old.instanceId)throw Error("repair_config_instance_mismatch");
   const health = await callBrowser(old, {action:"health"});
   if (health.status !== 200 || JSON.parse(health.data.toString()).active !== 0) throw Error("repair_requires_idle_pilot");
  }
  retainedExpiry = old.expiresAt;
  await storage.writeJson("browser-pilot/runtime.json", encryptConfig({...old,enabled:false},process.env.AUTH_SECRET), {ifMatch:priorMeta.etag});
  replacementEtag = (await storage.readJsonWithMeta<Envelope | null>("browser-pilot/runtime.json", null)).etag;
  if (!replacementEtag) throw Error("repair_etag_missing");
  if(vm.status!=="STOPPED")yc(["compute","instance","stop","--id",vm.id]);
  if (yc(["compute","instance","get","--id",vm.id]).status !== "STOPPED") throw Error("repair_stop_failed");
  yc(["compute","instance","delete","--id",vm.id]);
  existing=[]; prior=null;
  summary(`Stopped and replaced idle pilot ${vm.id}; original expiry retained. Never run two VMs.`);
 }
 if (process.env.REPLACE_FAILED_PILOT_ID && existing.length) {
  const failed = existing[0];
  if (existing.length !== 1 || prior || failed.id !== process.env.REPLACE_FAILED_PILOT_ID || !["STOPPED", "RUNNING", "STOPPING"].includes(failed.status) || failed.labels?.app !== "avtocena-browser" || failed.labels?.run !== process.env.REPLACE_FAILED_PILOT_RUN) throw Error("failed_pilot_replacement_guard");
  if (failed.status !== "STOPPED") yc(["compute", "instance", "stop", "--id", failed.id]);
  if (yc(["compute", "instance", "get", "--id", failed.id]).status !== "STOPPED") throw Error("failed_pilot_not_stopped");
  yc(["compute", "instance", "delete", "--id", failed.id]);
  summary(`Removed stopped unactivated pilot ${failed.id} before replacement.`);
  existing = [];
 }
 if (existing.length) {
  if (existing.length !== 1 || !prior) throw Error("existing_pilot_requires_review_no_duplicate_created");
  const config = decryptConfig(prior, process.env.AUTH_SECRET);
  if (config.instanceId !== existing[0].id || !config.enabled || config.expiresAt <= Date.now()) throw Error("existing_pilot_expired_or_disabled");
  const health = await callBrowser(config, {action: "health"}); if (health.status !== 200) throw Error("existing_pilot_unhealthy");
  summary(`Pilot already exists: ${existing[0].id}. No extra VM created. Worker release: ${config.releaseSha}.`); return;
 }
 if (prior) throw Error("stale_runtime_config_requires_review");
 const subnets = yc(["vpc", "subnet", "list"]) as any[];
 let subnet = subnets.find(v => v.zone_id === "ru-central1-a") || subnets.find(v => v.zone_id === "ru-central1-d");
 if (!subnet) {
  const networks = (yc(["vpc", "network", "list"]) as any[]).filter(v => v.name === name);
  if (networks.length > 1) throw Error("ambiguous_pilot_network");
  const network = networks[0] || yc(["vpc", "network", "create", "--name", name, "--labels", "app=avtocena-browser,pilot=true"]);
  if (networks[0] && network.labels?.app !== "avtocena-browser") throw Error("existing_network_not_owned_by_pilot");
  if (subnets.some(v => v.network_id === network.id)) throw Error("pilot_network_has_unsupported_subnets");
  subnet = yc(["vpc", "subnet", "create", "--name", name + "-a", "--network-id", network.id, "--zone", "ru-central1-a", "--range", "10.203.0.0/24", "--labels", "app=avtocena-browser,pilot=true"]);
  summary("Created dedicated pilot network and subnet in ru-central1-a.");
 }
 summary(`Preflight: Compute and VPC readable. Zone ${subnet.zone_id}. Fixed pilot: one VM, 2 vCPU, 8 GiB, 30 GB disk, two sessions; no autoscaling.`);
 const groups = yc(["vpc", "security-group", "list"]) as any[];
 let group = groups.find(v => v.name === name && v.network_id === subnet.network_id);
 if (!group) group = yc(["vpc", "security-group", "create", "--name", name, "--network-id", subnet.network_id,
  "--rule", "direction=ingress,port=8443,protocol=tcp,v4-cidrs=0.0.0.0/0",
  "--rule", "direction=egress,protocol=tcp,port=any,v4-cidrs=0.0.0.0/0",
  "--rule", "direction=egress,protocol=udp,port=53,v4-cidrs=0.0.0.0/0"]);
 const certPath = join(dir, "cert.pem"), keyPath = join(dir, "key.pem");
 execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "8", "-subj", "/CN=browser-pilot.internal", "-addext", "subjectAltName=DNS:browser-pilot.internal"], {stdio: "ignore"});
 const shared = randomBytes(48).toString("hex"), expiresAt = retainedExpiry || Date.now() + 7 * 86400000;
 console.log(`::add-mask::${shared}`);
 const releaseSha = process.env.IMAGE.split(":").at(-1)!;
 const workerEnv = `BROWSER_WORKER_KEY=${shared}\nRELEASE_SHA=${releaseSha}\nPILOT_EXPIRES_AT=${expiresAt}\n`;
 const startup = `#!/bin/bash
set -euo pipefail
# Chromium uses unprivileged user namespaces for its own sandbox.
# Enable the kernel prerequisite on this dedicated browser VM; keep AppArmor and seccomp enabled.
if [ -f /proc/sys/kernel/unprivileged_userns_clone ]; then
  sysctl kernel.unprivileged_userns_clone
  if [ "$(cat /proc/sys/kernel/unprivileged_userns_clone)" = 0 ]; then
    echo 'kernel.unprivileged_userns_clone=1' > /etc/sysctl.d/61-avtocena-browser-userns.conf
    sysctl -p /etc/sysctl.d/61-avtocena-browser-userns.conf
  fi
fi
if [ -f /proc/sys/user/max_user_namespaces ]; then
  sysctl user.max_user_namespaces
  if [ "$(cat /proc/sys/user/max_user_namespaces)" = 0 ]; then
    echo 'user.max_user_namespaces=1024' >> /etc/sysctl.d/61-avtocena-browser-userns.conf
    sysctl -p /etc/sysctl.d/61-avtocena-browser-userns.conf
  fi
fi
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || true
chown 1001:1001 /opt/avtocena-browser/tls/key.pem
systemctl daemon-reload
systemctl enable --now avtocena-browser-expiry.timer
# Metadata credentials stay on the host; browsers cannot contact metadata or private networks.
bash /opt/avtocena-browser/firewall.sh
curl -fsS --max-time 10 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' | docker login --username iam --password-stdin cr.yandex >/dev/null
docker pull ${process.env.IMAGE}
docker logout cr.yandex >/dev/null
systemctl enable --now avtocena-browser.service
`;
 const unit = `[Unit]
After=docker.service network-online.target
Requires=docker.service
[Service]
Restart=on-failure
RestartSec=5
StandardOutput=journal+console
StandardError=journal+console
ExecStartPre=/bin/bash /opt/avtocena-browser/firewall.sh
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
  write("/opt/avtocena-browser/tls/key.pem", readFileSync(keyPath,"utf8"), "0400"),
  write("/opt/avtocena-browser/seccomp.json", readFileSync("services/browser-pilot/seccomp_profile.json","utf8"), "0444"),
  write("/opt/avtocena-browser/start.sh", startup, "0700"),
  write("/opt/avtocena-browser/firewall.sh", '#!/bin/bash\nset -euo pipefail\n' + ['169.254.0.0/16','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'].map(cidr => `iptables -C DOCKER-USER -i docker0 -d ${cidr} -j DROP 2>/dev/null || iptables -I DOCKER-USER -i docker0 -d ${cidr} -j DROP`).join('\n') + '\n', "0700"),
  write("/etc/systemd/system/avtocena-browser.service", unit, "0644"),
  write("/etc/systemd/system/avtocena-browser-expiry.service", "[Service]\nType=oneshot\nExecStart=/usr/sbin/poweroff\n", "0644"),
  write("/etc/systemd/system/avtocena-browser-expiry.timer", `[Timer]\nOnCalendar=${new Date(expiresAt).toISOString().replace("T"," ").slice(0,19)} UTC\nPersistent=true\n[Install]\nWantedBy=timers.target\n`, "0644")
 ], runcmd: [["systemctl","enable","--now","docker"], ["bash","/opt/avtocena-browser/start.sh"]]};
 const metadata = join(dir,"cloud-init.json"); writeFileSync(metadata,"#cloud-config\n"+JSON.stringify(cloud),{mode:0o600});
 attempted = true;
 const vm = yc(["compute","instance","create","--name",name,"--zone",subnet.zone_id,"--platform","standard-v3","--cores","2","--core-fraction","100","--memory","8GB","--service-account-id","ajekvv7ulcilmppf8qj3","--create-boot-disk","image-family=ubuntu-2204-lts,image-folder-id=standard-images,size=30,type=network-ssd,auto-delete=true","--network-interface",`subnet-id=${subnet.id},nat-ip-version=ipv4,security-group-ids=${group.id}`,"--metadata-from-file",`user-data=${metadata}`,"--labels",`app=avtocena-browser,pilot=true,run=${process.env.GITHUB_RUN_ID}`]);
 createdId = vm.id;
 const ip = vm.network_interfaces?.[0]?.primary_v4_address?.one_to_one_nat?.address;
 if (!ip) throw Error("pilot_public_ip_missing");
 const config: BrowserConfig = {enabled:true,url:`https://${ip}:8443/v1`,key:shared,ca:readFileSync(certPath,"utf8"),expiresAt,instanceId:vm.id,releaseSha};
 summary(`Created pilot ${vm.id}; waiting for TLS worker health. Automatic VM shutdown: ${new Date(expiresAt).toISOString()}.`);
 let healthy = false;
 for(let i=0;i<48;i++) {try {const health=await callBrowser(config,{action:"health"});const body=JSON.parse(health.data.toString());if(health.status===200&&body.ok&&body.release===releaseSha){healthy=true;break;}}catch{} await new Promise(resolve=>setTimeout(resolve,10000));}
 if(!healthy) throw Error("pilot_health_timeout_VM_will_be_stopped");
 // Verify the actual browser session before making the pilot available.
 const probeOwner = randomBytes(32).toString("hex"), probeId = randomUUID();
 try {
  const started = await callBrowser(config,{action:"create",owner:probeOwner,id:probeId,prompt:"Honda Fit BASIC 2022 характеристики двигателя мощность объём тип топлива рынок Японии"});
  if(started.status!==200)throw Error("probe_create_failed");
  let ready=false;
  for(let i=0;i<25;i++){
   await new Promise(resolve=>setTimeout(resolve,2000));
   const response=await callBrowser(config,{action:"heartbeat",owner:probeOwner,id:probeId});
   const state=JSON.parse(response.data.toString());
   if(state.state==="ready"){ready=true;break;}
   if(state.state==="failed"){
    const diagnostic=JSON.parse((await callBrowser(config,{action:"health"})).data.toString()).lastFailure;
    summary("Browser diagnostic: "+JSON.stringify(diagnostic||{code:state.error}));
    throw Error("pilot_browser_probe_failed");
   }
  }
  if(!ready)throw Error("pilot_browser_probe_timeout");
  const frame=await callBrowser(config,{action:"frame",owner:probeOwner,id:probeId});
  if(frame.status!==200||frame.data.length<100)throw Error("pilot_frame_probe_failed");
  summary("Actual browser session reached ready and returned a frame.");
 } finally {await callBrowser(config,{action:"close",owner:probeOwner,id:probeId}).catch(()=>{});}
 // Publish only an encrypted envelope. No worker key, chat or screenshot in the bucket.
 await storage.writeJson("browser-pilot/runtime.json", encryptConfig(config,process.env.AUTH_SECRET), replacementEtag ? {ifMatch:replacementEtag} : {ifNoneMatch:"*"});
 activated=true; summary(`Pilot enabled. Worker ${process.env.GITHUB_SHA}; max 2 sessions, 20s lease, 90s idle, 10min lifetime. No automatic renewal after 7 days.`);
}
main().catch(error=>{summary(String(error.message)); if(attempted&&!createdId){try{const vm=yc(["compute","instance","get","--name",name]);if(vm.labels?.run===process.env.GITHUB_RUN_ID)createdId=vm.id;}catch{}} if(createdId&&!activated){try{
 const serial=execFileSync(process.env.YC_BIN||"yc",["compute","instance","get-serial-port-output","--id",createdId,"--port","1","--folder-id",folder],{encoding:"utf8",timeout:40000,stdio:["ignore","pipe","pipe"],maxBuffer:4000000});
 summary(serial.split(/\r?\n/).filter(l=>/chromium_launch_error|browser_start_failure|unprivileged_userns|max_user_namespaces|apparmor.*DENIED/.test(l)).slice(-12).join("\n"));
 }catch{}try{yc(["compute","instance","stop","--id",createdId]);summary("Failed pilot VM stopped; disk remains for review.");}catch{summary(`ATTENTION: stop pilot VM ${createdId} in Yandex Cloud; automatic cleanup failed.`);}}process.exitCode=1;}).finally(()=>rmSync(dir,{recursive:true,force:true}));
