import { createHash, randomBytes } from "node:crypto";

const SECRET_FIELD_PATTERN = /(^|_)(authorization|token|secret|password|api_key|apikey)($|_)/i;

export function hashDeviceInstallId(deviceInstallId) {
  return createHash("sha256").update(`pm-installation-v1:${deviceInstallId}`).digest("hex");
}

export function generateAnonPublicId() {
  return `pm_${randomBytes(12).toString("hex")}`;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SECRET_FIELD_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(nestedValue)
      ])
    );
  }

  return value;
}
