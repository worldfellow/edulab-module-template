---
name: edulab-module
description: Exact formats for building an Edulab Bench module — schema JSON field types, permissions, manifest fields, ctx API, events, release checks. Use when adding or changing an entity, hook, endpoint, job, setting or release in this module.
---

# Edulab module reference (contract v0)

## schema/<entity>.json
```json
{
  "name": "allotment", "label": "Room Allotment",
  "naming": "ALT-{YYYY}-{#####}",
  "trackChanges": true,
  "fields": [
    { "name": "student", "type": "link", "to": "core.student", "required": true },
    { "name": "status", "type": "select", "options": ["Requested","Allotted"], "default": "Requested" },
    { "name": "guardian_phone", "type": "phone", "pii": true }
  ],
  "unique": [["student", "from"]],
  "permissions": {
    "hostel:admin": ["read","create","update","delete"],
    "hostel:student": { "actions": ["read","create"], "onlyOwn": "student" }
  }
}
```
Generated per site: table `<module>.<entity>` (own Postgres schema in the university's DB; module DB role can write only its own section, read `core` + `dependsOn` sections), `GET/POST /api/<module>/<entity>`, `GET/PATCH/DELETE /api/<module>/<entity>/:id` (filters, paging), list + form screens, permission checks, change history, column migrations on version upgrade.

Field types: `text` `longtext` (maxLength) · `number` `decimal` (min,max) · `money` (paise) · `check` · `date` `datetime` `time` (UTC stored) · `select` (options) · `link` (to: `core.<e>` | `<this module>.<e>` | entity of a `dependsOn` module) · `table` (of: child schema in this module) · `file` `image` (private default) · `email` `phone` · `json` (avoid).
Field keys: `name` `type` `required` `unique` `default` `pii` `min` `max` `maxLength` `options` `to` `of`.
Core entities: `core.user` `core.student` `core.college` `core.faculty` `core.department` `core.programme` `core.subject` `core.academic_year`. Link to them, never copy them. Programme = degree programme (B.Sc. CS, has semesters); subject = one paper/course unit. Semester is a number field. Core events you may listen to: `core.student.created`, `core.student.updated`, `core.user.created`.

## Accessibility (required: IS 17802 / WCAG 2.1 AA)
Platform screens are accessible; keep it so: plain-word labels for every field/entity, workflow actions as verbs, guard errors say what to fix, no meaning by colour alone, accessible email HTML (headings, alt text). Test with keyboard only and on a phone.

## Languages (coming)
Stored values (options, states, API, CSV, events) stay English; translations in i18n/<lang>.json mirror the schema (label, fields.<f>.label/options, actions); status machine-draft|reviewed. Keep option values stable; write simple English labels.

## Notifications
manifest "notifies": ["email","whatsapp"]; in on() hooks: ctx.notify.email({ to, subject, html } | { to, template, variables }), ctx.notify.whatsapp({ to, template, params }). Queued in the hook transaction, sent after commit, retried. WhatsApp = Meta-approved template only; no SMS. Dev redirects to a test address.

## Reports and dashboard
reports/<name>.json: { "title", "entity": "<own entity>", "groupBy"?: "<field>" | "<date field>:day|month|year", "measures": [{ "fn": "count" } | { "fn": "sum|avg|min|max", "field": "<number|money|decimal>" }, "label"?], "filters"?: [select/link/check/date/datetime fields], "where"?: { field: value }, "chart"?: "bar"|"none", "dashboard"?: true }. Viewer's row permissions apply. Screen /r/<m>/<name>; API GET /api/_reports/<m>/<name>[/csv]; PDF /r/<m>/<name>/pdf; date filters <field>_from/_to.

## Print formats and PDF
print/<entity>.html (optional; default prints every field). {{field}} formatted + escaped (image field = picture), {{#table_field}}…{{/table_field}} loops child rows, {{site.name}} {{id}} {{today}}. Plain HTML/CSS (A4; classes kv, lines); no scripts/handlers/external URLs. /m/<m>/<e>/<id>/print and /pdf.

## Verify with DigiLocker
Entity JSON "digilocker": { "aadhaar"|"apaar"|"class_x"|"class_xii": "<file field accepting pdf>", "verified": "<check field>" }. Platform adds the button, fetches signed PDFs into the fields, ticks verified (never settable by users). Guard on the verified field.

## Files and images
Field type "file" (accept pdf/jpg/png) or "image" (jpg/png); "accept": [...], "maxSizeMB" (default 5, max 200), "pii": true for personal documents. Upload: POST /api/<m>/<e>/<id>/files/<field> (multipart "file"). Download: GET /api/_files/<key>, only for users who may read the record. Never set a file field directly.

## Workflow (status that moves through steps)
In the entity JSON: "workflow": { "field": "<select>", "start": "<option>", "edit": { "<state>": ["role"] }, "actions": [ { "name", "from": [...], "to", "roles": [...], "comment": "required"|"optional" } ] }.
Never set the state field directly; it changes only via actions (POST /api/<m>/<e>/<id>/actions/<slug>). Guards: before("<entity>.<Action>", fn) in src/hooks.ts, throw to block. Event per state reached: <module>.<entity>.<state_slug> (declare in emits).

## Permissions
Role entry is `["read",…]` or `{ "actions": […], "onlyOwn": "<link field>", "scope": "<link field or path>" }`.
- `onlyOwn`: row visible only if the link points at the current user — `core.user`, `core.student` (student.user = me), or an entity of this module that has a `user` link field (employee, evaluator, candidate…). Parents see their linked students' rows.
- `scope`: row visible only if the linked record is in the user's assignments (`core.user_scope`: user → entity → records, managed by the site admin). Use for college staff (`"scope": "college"`), wardens (`"room.hostel"` — dotted path through links), HODs (`"department"`), agents, managers. Can combine with onlyOwn? No — pick one per role.

## manifest.json keys
`name` (lowercase, unique) · `title` · `version` (semver: patch fix, minor add, major remove/change) · `publisher` · `core` (range) · `dependsOn` {module: range} (required modules; may link to + listen to them) · `optionalDependsOn` {module: range} (may listen to their events if installed; no links) · `secrets` ["gateway.api_key"] (set per site by superadmin, read with `ctx.secrets.get`) · `publicRoutes` ["/<module>/callback/:provider"] (no login; handler must verify a signature) · `roles` {"<module>:<role>": "description"} · `events` {emits:[], listens:[]} (undeclared = blocked) · `settings` {key: {type, default, label}} · `price` {plan}.

## Code: ctx (every hook, endpoint, job receives it)
```ts
import { on } from "@edulab/core";
on("fees.payment.received", async (ctx, event) => {
  await ctx.db.hostel.allotment.update({ student: event.student }, { status: "Allotted" });
  await ctx.emit("hostel.allotment.created", { student: event.student });
});
```
`ctx.site.code` · `ctx.user` {id, username, roles} in endpoints, null in hooks/jobs · `ctx.db.<module>.<entity>`: list/find(where, {orderBy:"f desc", limit, offset}), get(id)→row|null, create/insert(values), update(where, patch)→rows|null (locks rows: conditional update wins once), delete(where)→count; where {f: v} | {f: null} | {f: {in: [..]}}; user permissions apply in endpoints, `ctx.db.asSystem()` bypasses (justify in a comment); hooks/jobs run as system · `ctx.settings` · `ctx.emit(name, payload)` · `ctx.call("<dep>.<fn>", body)` → dep's src/api/<fn-kebab>.ts, same tx, only dependsOn modules · `ctx.jobs.enqueue(name, payload)` · `ctx.notify.email/whatsapp` · `ctx.log(.info/.warn/.error)`. Not yet: ctx.files, ctx.secrets.

## Endpoints, jobs, pages
src/api/<kebab>.ts → /api/<module>/<kebab>: `export const method = "POST"` (GET/POST/PATCH/DELETE), `export const roles = [manifest roles]` (required), `export default async (ctx, body) => result`. One transaction. Client errors: `throw Object.assign(new Error(msg), { status: 409 })`. Name ≠ any entity name.
src/jobs/<kebab>.ts: `export default async (ctx, payload) => summary`, optional `export const schedule = "hourly" | "every N minutes" (N≥5) | "daily HH:MM"`. Run via ctx.jobs.enqueue or the site's Jobs screen / POST /api/_jobs/<m>/<job>. 3 tries, idempotent.
pages/<name>.html + manifest "pages": {"<name>": {"title", "roles": [...]}} → /p/<module>/<name> (login + role). Assets next to it at /p/<module>/<file>. fetch("/api/...") (login cookie; never send x-user/x-roles headers; who am I = GET /api/_me). Link /_theme.css + /_portal.css, no own colours/fonts. CSP: only same-site scripts/API, Google Fonts, YouTube/Vimeo iframes. Escape user text; only https:// links. No public pages yet.
Never: open DB connections, read env vars, resolve the university yourself.

## Events
Name `<module>.<entity>.<past-verb>`. Payload = IDs + few needed fields. Delivered at least once → handlers idempotent. Never cross universities. No dependency cycles: if A depends on B, B must not listen to A — A calls B's API (`ctx.call("b.createDemand", …)`).

## Try before release (branch preview, §7)
Push to the agreed branch → in ~2 min it is checked + installed on the team's dev site only (<team>.dev.digitalvarsity.org). No version bump/tag/review. Failing commit = site keeps the last working one.

## Release (docs/building-a-module.md §7)
Check: `node scripts/validate.mjs` (silent = OK). Release: bump `version` in manifest.json → add `## <version>` to CHANGELOG.md → commit + push main → `git tag v<version> && git push origin v<version>`. The control plane picks the tag up in ~2 min, runs the checks; result = failed / waiting for review / rejected / approved. Tag = `v` + exact manifest version, always newer than the last approved; a used number is never reused (fix → next patch); never move/delete a tag; removing an entity/field needs a major version; dependencies must already be approved. `edulab` CLI commands (`edulab dev`, `edulab release`) don't exist yet.

## Errors on live sites (docs/building-a-module.md §7 "Errors and crash reports")
Hook throws + 500s are recorded automatically with version + stack (no code needed). Developer error link / `GET /api/dev/errors?module=<m>` + `x-error-key`. Never put personal data in error messages. Fix = next patch version.

## Release checks
Automatic now: valid manifest + schemas · name = registered repo · tag = manifest version, newer · nothing removed without major · dependencies approved · install twice = no change · upgrade from last approved · secret scan · README exists · CHANGELOG entry. Reviewer checks by hand for now: every entity has permissions · no cross-module imports/queries · only declared events · pii marked · no university names/URLs · tests · VAPT · README sections filled.

## Permissions actions
`read` `create` `update` `delete` `import` `export`. `import`/`export` enable the automatic Data Import/Export screens (template download → upload → preview → background job → per-row log → history) for that entity. No module code needed.

## import/ (only when replacing an old Edulab product)
`import/MAPPING.md` (old table → core / module / other / drop) · `import/sources.json` (old systems + totals checks) · `import/mappers/<entity>.ts`:
```ts
import { mapper } from "@edulab/core/import";
export default mapper({
  from: "legacy.hostel_allotments", to: "hostel.allotment", key: (row) => row.id,
  map: async (row, ctx) => ({ student: await ctx.ref("core.student", { prn: row.prn }), status: { A: "Allotted" }[row.status] }),
});
```
Core imports core data first (students de-duplicated by PRN/email/mobile); mappers only `ctx.ref` it, never create it. Dependencies import first. Re-runnable via `platform.import_map`. Unmappable row → `throw` with a reason.

## Uninstall
Roles, screens, API, handlers removed; the module's section is renamed to an archive, files kept, never deleted.
