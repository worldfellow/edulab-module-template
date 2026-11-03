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
const ACTIONS = new Set(["read", "create", "update", "delete", "import", "export"]);
const CORE = new Set(["user", "student", "college", "faculty", "department", "programme", "subject", "academic_year"]);
const OWNER_CORE = new Set(["core.user", "core.student"]);
const SEMVER = /^\d+\.\d+\.\d+$/;
const IDENT = /^[a-z][a-z0-9_]*$/;

const m = existsSync(join(root, "manifest.json")) ? readJson("manifest.json") : (err("manifest.json", "missing"), null);
const schemaDir = join(root, "schema");
const schemaFiles = existsSync(schemaDir) ? readdirSync(schemaDir).filter((f) => f.endsWith(".json")) : [];
const entities = new Set(schemaFiles.map((f) => basename(f, ".json")));
// entities that represent a person: they have a link field "user" to core.user
const ownerSchemas = new Set(schemaFiles.filter((f) => {
  try { return JSON.parse(readFileSync(join(schemaDir, f), "utf8")).fields?.some((x) => x.name === "user" && x.to === "core.user"); }
  catch { return false; }
}).map((f) => basename(f, ".json")));

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
  const optional = new Set(Object.keys(m.optionalDependsOn || {}));
  for (const d of optional) if (deps.has(d)) err("manifest.json", `"${d}" is in both dependsOn and optionalDependsOn`);
  for (const sec of m.secrets || []) if (!/^[a-z0-9_.]+$/.test(sec)) err("manifest.json", `secret "${sec}" must be lowercase dotted name, e.g. gateway.api_key`);
  for (const route of m.publicRoutes || []) if (!String(route).startsWith(`/${m.name}/`)) err("manifest.json", `public route "${route}" must start with "/${m.name}/"`);
  for (const ev of m.events?.emits || []) {
    if (!new RegExp(`^${m.name}\\.[a-z0-9_]+\\.[a-z_]+$`).test(ev)) err("manifest.json", `emitted event "${ev}" must be "${m.name}.<entity>.<past-verb>"`);
  }
  for (const ev of m.events?.listens || []) {
    const src = ev.split(".")[0];
    if (src !== m.name && src !== "core" && !deps.has(src) && !optional.has(src)) err("manifest.json", `listens to "${ev}" but "${src}" is not in dependsOn or optionalDependsOn`);
  }
  for (const [k, s] of Object.entries(m.settings || {})) {
    if (!SETTING_TYPES.has(s?.type)) err("manifest.json", `setting "${k}" type must be one of ${[...SETTING_TYPES].join(", ")}`);
    if (!s?.label) err("manifest.json", `setting "${k}" needs a label`);
  }
}

if (m && m.notifies !== undefined) {
  const ok = ["email", "whatsapp"];
  if (!Array.isArray(m.notifies) || !m.notifies.every((c) => ok.includes(c)))
    err("manifest.json", `notifies must list channels from: ${ok.join(", ")}`);
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
      // Links use the schema name (hyphens become underscores): document-services → document_services.<entity>.
      const us = (s) => s.replace(/-/g, "_");
      const ok = (mod === "core" && CORE.has(ent)) || (m && us(mod) === us(m.name) && entities.has(ent)) || (m && Object.keys(m.dependsOn || {}).map(us).includes(us(mod)));
      if (!ok) err(rel, `${at}: link "to" must be core.<${[...CORE].join("|")}>, ${m?.name}.<entity in schema/>, or an entity of a dependsOn module`);
    }
    if (f.type === "file" || f.type === "image") {
      const kinds = f.type === "image" ? ["jpg", "png"] : ["pdf", "jpg", "png"];
      if (f.accept !== undefined && !(Array.isArray(f.accept) && f.accept.length && f.accept.every((k) => kinds.includes(k))))
        err(rel, `${at}: accept must list some of ${kinds.join(", ")}`);
      if (f.maxSizeMB !== undefined && !(Number.isFinite(f.maxSizeMB) && f.maxSizeMB > 0 && f.maxSizeMB <= 200))
        err(rel, `${at}: maxSizeMB must be a number from 1 to 200`);
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
    if (!Array.isArray(acts) || !acts.every((a) => ACTIONS.has(a))) err(rel, `role "${role}": actions must be from read, create, update, delete, import, export`);
    if (p?.onlyOwn) {
      const f = fields.find((x) => x.name === p.onlyOwn);
      const [mod, ent] = String(f?.to || "").split(".");
      if (f?.type !== "link") err(rel, `role "${role}": onlyOwn must name a link field`);
      else if (mod === "core" && !OWNER_CORE.has(f.to))
        err(rel, `role "${role}": onlyOwn "${p.onlyOwn}" links to ${f.to}, which is not a person. Use "scope" for colleges, departments, hostels…`);
      else if (mod === m?.name && !ownerSchemas.has(ent))
        err(rel, `role "${role}": onlyOwn "${p.onlyOwn}" links to ${f.to}, which has no "user" link field`);
    }
    if (p?.scope) {
      const first = String(p.scope).split(".")[0];
      if (fields.find((x) => x.name === first)?.type !== "link") err(rel, `role "${role}": scope must start with a link field (e.g. "college" or "room.hostel")`);
    }
  }
  // workflow: a select field that changes only through declared actions (docs/building-a-module.md, "Workflows")
  const w = s.workflow;
  if (w) {
    const sf = fields.find((x) => x.name === w.field);
    if (sf?.type !== "select") err(rel, `workflow: "field" must name a select field`);
    else {
      const states = new Set(sf.options);
      const roles = new Set(Object.keys(m?.roles || {}));
      if (!states.has(w.start)) err(rel, `workflow: start "${w.start}" is not one of ${w.field}'s options`);
      if (!Array.isArray(w.actions) || !w.actions.length) err(rel, "workflow: actions are required");
      const seen = new Set();
      for (const a of w.actions || []) {
        const an = `workflow action "${a.name}"`;
        const sl = String(a.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
        if (!a.name || seen.has(sl)) err(rel, `${an}: missing or duplicate name`);
        seen.add(sl);
        if (!Array.isArray(a.from) || !a.from.length || !a.from.every((x) => states.has(x))) err(rel, `${an}: "from" must list ${w.field} options`);
        if (!states.has(a.to)) err(rel, `${an}: "to" "${a.to}" is not one of ${w.field}'s options`);
        if (!Array.isArray(a.roles) || !a.roles.length || !a.roles.every((r) => roles.has(r))) err(rel, `${an}: roles must be declared in manifest roles`);
        if (a.comment !== undefined && !["required", "optional"].includes(a.comment)) err(rel, `${an}: comment is "required" or "optional"`);
      }
      for (const [st, rs] of Object.entries(w.edit || {})) {
        if (!states.has(st)) err(rel, `workflow: edit state "${st}" is not one of ${w.field}'s options`);
        if (!Array.isArray(rs) || !rs.every((r) => roles.has(r))) err(rel, `workflow: edit roles for "${st}" must be declared in manifest roles`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Edulab module contract: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
  process.exit(2);
}
