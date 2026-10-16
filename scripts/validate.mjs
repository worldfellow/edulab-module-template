#!/usr/bin/env node
// Checks manifest.json and schema/*.json against the Edulab module contract v0.
// Silent + exit 0 when valid; errors on stderr + exit 2 (Claude Code hooks feed stderr back to Claude).
// ponytail: stand-in until `edulab validate` exists in the core CLI; then this file goes.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const root = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const readJson = (file) => {
  try { return JSON.parse(readFileSync(join(root, file), "utf8")); }
  catch (e) { err(file, `not valid JSON (${e.message})`); return null; }
};

const FIELD_TYPES = new Set(["text", "longtext", "number", "decimal", "money", "check", "date", "datetime", "time",
  "select", "link", "table", "file", "image", "email", "phone", "json"]);
const SETTING_TYPES = new Set(["text", "number", "check", "select", "date"]);
const ACTIONS = new Set(["read", "create", "update", "delete"]);
const CORE = new Set(["user", "student", "college", "programme", "course", "subject", "academic_year"]);
const SEMVER = /^\d+\.\d+\.\d+$/;
const IDENT = /^[a-z][a-z0-9_]*$/;

const m = existsSync(join(root, "manifest.json")) ? readJson("manifest.json") : (err("manifest.json", "missing"), null);
const schemaDir = join(root, "schema");
const schemaFiles = existsSync(schemaDir) ? readdirSync(schemaDir).filter((f) => f.endsWith(".json")) : [];
const entities = new Set(schemaFiles.map((f) => basename(f, ".json")));

if (m) {
  if (!/^[a-z][a-z0-9-]*$/.test(m.name || "")) err("manifest.json", `name "${m.name}" must be lowercase letters, digits, hyphens`);
  if (!SEMVER.test(m.version || "")) err("manifest.json", `version "${m.version}" must be semver like 1.2.3`);
  if (!m.core) err("manifest.json", "core version range is required");
  for (const k of ["title", "publisher"]) if (!m[k]) err("manifest.json", `${k} is required`);
  for (const [role, desc] of Object.entries(m.roles || {})) {
    if (!role.startsWith(`${m.name}:`)) err("manifest.json", `role "${role}" must start with "${m.name}:"`);
    if (!desc) err("manifest.json", `role "${role}" needs a one-line description`);
  }
  if (!Object.keys(m.roles || {}).length) err("manifest.json", "declare at least one role");
  const deps = new Set(Object.keys(m.dependsOn || {}));
  for (const ev of m.events?.emits || []) {
    if (!new RegExp(`^${m.name}\\.[a-z0-9_]+\\.[a-z_]+$`).test(ev)) err("manifest.json", `emitted event "${ev}" must be "${m.name}.<entity>.<past-verb>"`);
  }
  for (const ev of m.events?.listens || []) {
    const src = ev.split(".")[0];
    if (src !== m.name && src !== "core" && !deps.has(src)) err("manifest.json", `listens to "${ev}" but "${src}" is not in dependsOn`);
  }
  for (const [k, s] of Object.entries(m.settings || {})) {
    if (!SETTING_TYPES.has(s?.type)) err("manifest.json", `setting "${k}" type must be one of ${[...SETTING_TYPES].join(", ")}`);
    if (!s?.label) err("manifest.json", `setting "${k}" needs a label`);
  }
}

for (const file of schemaFiles) {
  const rel = `schema/${file}`;
  const s = readJson(rel);
  if (!s) continue;
  const fname = basename(file, ".json");
  if (s.name !== fname) err(rel, `name "${s.name}" must match the file name "${fname}"`);
  if (!s.label) err(rel, "label is required");
  const fields = Array.isArray(s.fields) ? s.fields : (err(rel, "fields must be an array"), []);
  const names = new Set();
  for (const f of fields) {
    const at = `field "${f.name}"`;
    if (!IDENT.test(f.name || "")) err(rel, `${at}: name must be snake_case`);
    if (names.has(f.name)) err(rel, `${at}: duplicate`);
    names.add(f.name);
    if (!FIELD_TYPES.has(f.type)) { err(rel, `${at}: unknown type "${f.type}"`); continue; }
    if (f.type === "select" && !(Array.isArray(f.options) && f.options.length)) err(rel, `${at}: select needs options`);
    if (f.type === "table" && !entities.has(f.of)) err(rel, `${at}: "of" must name a schema file in this module`);
    if (f.type === "link") {
      const [mod, ent] = String(f.to || "").split(".");
      const ok = (mod === "core" && CORE.has(ent)) || (m && mod === m.name && entities.has(ent)) || (m && mod in (m.dependsOn || {}));
      if (!ok) err(rel, `${at}: link "to" must be core.<${[...CORE].join("|")}>, ${m?.name}.<entity in schema/>, or an entity of a dependsOn module`);
    }
    if (f.type === "decimal" && /fee|amount|price|cost/i.test(f.name)) err(rel, `${at}: use type "money" for amounts`);
    if (["email", "phone"].includes(f.type) && !f.pii) err(rel, `${at}: ${f.type} is personal data, add "pii": true`);
  }
  for (const u of s.unique || []) for (const n of u) if (!names.has(n)) err(rel, `unique refers to unknown field "${n}"`);
  const perms = s.permissions || {};
  if (!Object.keys(perms).length) err(rel, "permissions are required (no permission = no access)");
  for (const [role, p] of Object.entries(perms)) {
    if (m && !(role in (m.roles || {}))) err(rel, `permission role "${role}" is not declared in manifest roles`);
    const acts = Array.isArray(p) ? p : p?.actions;
    if (!Array.isArray(acts) || !acts.every((a) => ACTIONS.has(a))) err(rel, `role "${role}": actions must be from read, create, update, delete`);
    if (p?.onlyOwn && fields.find((f) => f.name === p.onlyOwn)?.type !== "link") err(rel, `role "${role}": onlyOwn must name a link field`);
  }
}

if (errors.length) {
  console.error(`Edulab module contract: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
  process.exit(2);
}
