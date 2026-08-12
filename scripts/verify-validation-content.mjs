import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = `${root}apps/api/validation-content/manifest.json`;
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.status !== "ready" || manifest.validationOnly !== true ||
    manifest.humanAudioReviewed !== false || manifest.azureAudioValidated !== false ||
    manifest.contentVersionId!=="84a11917-7498-40d0-aca4-fb8d096e1f41" ||
    manifest.stableReleaseId!=="development-validation-r-l" || manifest.version!==1 ||
    manifest.focusGroupKey!=="r-l") {
  throw new Error("validation manifest classification is invalid");
}

const canonical = [];
for (const asset of manifest.assets) {
  for (const variantName of ["standard", "slow"]) {
    const variant = asset[variantName];
    const relative = variant.url.replace(/^\//, "");
    const bytes = await readFile(`${root}apps/api/public/${relative}`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== variant.sha256) throw new Error(`checksum mismatch: ${asset.key}.${variantName}`);
    if (bytes.byteLength <= 4096) throw new Error(`empty validation audio: ${asset.key}.${variantName}`);
    canonical.push(`${asset.key}.${variantName}=${actual}`);
  }
}
const digest = createHash("sha256").update(`${canonical.join("\n")}\n`).digest("hex");
if (digest !== manifest.manifestSha256) throw new Error("validation manifest checksum mismatch");

console.log(`validated ${canonical.length} development-only audio assets`);
