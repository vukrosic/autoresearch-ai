import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const templatesRoot = path.join(packageRoot, "templates");

export function defaultSafetyPolicy() {
  return {
    allowPrefixes: ["python", "python3", "bash", "sh", "node", "npm", "npx", "uv", "make", "pytest", "printf", "echo", "sleep", "false", "true"],
    denySubstrings: ["rm -rf", "sudo", "curl", "wget", "mkfs", "shutdown", "reboot", "poweroff"],
    maxMinutesPerRun: 60,
    maxCostUsdPerRun: 0,
  };
}

export function parseSafetyScalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (/^\[.*\]$/.test(text)) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((entry) => parseSafetyScalar(entry.trim()));
  }
  return text;
}

export function normalizeSafetyPolicy(policy) {
  const defaults = defaultSafetyPolicy();
  const allowPrefixes = Array.isArray(policy.allowPrefixes)
    ? policy.allowPrefixes.map((entry) => String(entry).trim()).filter(Boolean)
    : defaults.allowPrefixes;
  const denySubstrings = Array.isArray(policy.denySubstrings)
    ? policy.denySubstrings.map((entry) => String(entry).trim()).filter(Boolean)
    : defaults.denySubstrings;
  const maxMinutesPerRun = Number(policy.maxMinutesPerRun);
  const maxCostUsdPerRun = Number(policy.maxCostUsdPerRun);
  return {
    allowPrefixes: allowPrefixes.length ? allowPrefixes : defaults.allowPrefixes,
    denySubstrings: denySubstrings.length ? denySubstrings : defaults.denySubstrings,
    maxMinutesPerRun: Number.isFinite(maxMinutesPerRun) && maxMinutesPerRun > 0 ? maxMinutesPerRun : defaults.maxMinutesPerRun,
    maxCostUsdPerRun: Number.isFinite(maxCostUsdPerRun) && maxCostUsdPerRun >= 0 ? maxCostUsdPerRun : defaults.maxCostUsdPerRun,
  };
}

export function parseSafetyPolicy(text) {
  const policy = {
    allowPrefixes: [],
    denySubstrings: [],
    maxMinutesPerRun: undefined,
    maxCostUsdPerRun: undefined,
  };
  let activeList = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const listMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
    if (listMatch) {
      activeList = listMatch[1];
      continue;
    }
    const scalarMatch = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (scalarMatch) {
      const key = scalarMatch[1];
      const value = parseSafetyScalar(scalarMatch[2]);
      if (key === "allow_prefixes" || key === "allowPrefixes") policy.allowPrefixes = Array.isArray(value) ? value : [value];
      else if (key === "deny_substrings" || key === "denySubstrings") policy.denySubstrings = Array.isArray(value) ? value : [value];
      else if (key === "max_minutes_per_run" || key === "maxMinutesPerRun") policy.maxMinutesPerRun = value;
      else if (key === "max_cost_usd_per_run" || key === "maxCostUsdPerRun") policy.maxCostUsdPerRun = value;
      activeList = null;
      continue;
    }
    const itemMatch = line.match(/^-\s*(.+)$/);
    if (itemMatch && activeList) {
      const value = String(parseSafetyScalar(itemMatch[1]));
      if (activeList === "allow_prefixes" || activeList === "allowPrefixes") policy.allowPrefixes.push(value);
      else if (activeList === "deny_substrings" || activeList === "denySubstrings") policy.denySubstrings.push(value);
    }
  }
  return normalizeSafetyPolicy(policy);
}

export function loadSafetyPolicy(cwd) {
  const candidates = [
    path.join(cwd, ".researchloop", "safety.yaml"),
    path.join(templatesRoot, "base", "safety.yaml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      return parseSafetyPolicy(fs.readFileSync(file, "utf8"));
    } catch {
      // Fall through to defaults.
    }
  }
  return defaultSafetyPolicy();
}

export function evaluateCommandSafety(commandText, policy) {
  const normalizedCommand = String(commandText || "").trim();
  const lowerCommand = normalizedCommand.toLowerCase();
  const denyMatch = (policy.denySubstrings || []).find((needle) => {
    const trimmed = String(needle || "").trim();
    return trimmed && lowerCommand.includes(trimmed.toLowerCase());
  });
  if (denyMatch) {
    return {
      allowed: false,
      rule: "deny_substrings",
      message: `matches deny_substrings: ${denyMatch}`,
    };
  }

  const prefixMatch = (policy.allowPrefixes || []).find((prefix) => {
    const trimmed = String(prefix || "").trim();
    return trimmed && normalizedCommand.startsWith(trimmed);
  });
  if (!prefixMatch) {
    return {
      allowed: false,
      rule: "allow_prefixes",
      message: `does not start with an allowed prefix (${(policy.allowPrefixes || []).join(", ")})`,
    };
  }

  const maxMinutes = Number(policy.maxMinutesPerRun);
  const maxMs = Number.isFinite(maxMinutes) && maxMinutes > 0 ? Math.max(1, Math.floor(maxMinutes * 60_000)) : null;
  return {
    allowed: true,
    rule: null,
    message: "",
    maxMs,
  };
}
