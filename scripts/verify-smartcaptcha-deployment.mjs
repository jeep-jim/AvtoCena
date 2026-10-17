import crypto from "node:crypto";

// Read-only runtime verification. Never log environment values or create leads.
const clientKey = process.env.SMARTCAPTCHA_CLIENT_KEY || "";
const serverKey = process.env.SMARTCAPTCHA_SERVER_KEY || "";
if (!clientKey && !serverKey) {
  console.log("SmartCaptcha: keys are not configured; activation skipped.");
  process.exit(0);
}
if (!clientKey || !serverKey) throw new Error("SmartCaptcha requires both repository secrets");
const key = JSON.parse(process.env.YC_SA_JSON_CREDENTIALS || "{}");
const now = Math.floor(Date.now() / 1000);
const enc = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const iam = "https://iam.api.cloud.yandex.net/iam/v1/tokens";
const unsigned = enc({alg:"PS256",typ:"JWT",kid:key.id}) + "." + enc({iss:key.service_account_id,aud:iam,iat:now,exp:now+600});
const signature = crypto.sign("sha256", Buffer.from(unsigned), {
  key:key.private_key.slice(key.private_key.indexOf("-----BEGIN")),
  padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32,
}).toString("base64url");
const tokenResponse = await fetch(iam, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jwt:unsigned+"."+signature}),signal:AbortSignal.timeout(15000)});
if (!tokenResponse.ok) throw new Error("IAM verification failed: " + tokenResponse.status);
const {iamToken} = await tokenResponse.json();
async function get(path) {
  const response = await fetch("https://serverless-containers.api.cloud.yandex.net/containers/v1/" + path, {
    headers:{Authorization:"Bearer " + iamToken},signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Runtime verification failed: " + response.status);
  return response.json();
}
const {containers = []} = await get("containers?folderId=b1g9vq73onqb7dp5hgqg");
const container = containers.find(item => item.name === "avtocena-web");
if (!container) throw new Error("Production container not found");
const {revisions = []} = await get("revisions?containerId=" + encodeURIComponent(container.id));
const revision = revisions.find(item => item.status === "ACTIVE" && item.image?.environment?.AVTOCENA_RELEASE_SHA === process.env.GITHUB_SHA);
if (!revision) throw new Error("Active revision for this release not found");
if (revision.image.environment.SMARTCAPTCHA_CLIENT_KEY !== clientKey || revision.image.environment.SMARTCAPTCHA_SERVER_KEY !== serverKey) {
  throw new Error("Active revision does not contain the configured SmartCaptcha keys");
}
console.log(JSON.stringify({smartCaptchaConfigured:true,activeRevision:revision.id,release:process.env.GITHUB_SHA}));
