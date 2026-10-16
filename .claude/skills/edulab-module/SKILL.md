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
`ctx.site` current university (read-only) · `ctx.secrets.get(name)` declared secrets · `ctx.user` user + roles · `ctx.db.<module>.<entity>` / `ctx.db.core.<entity>` (permissions applied; `ctx.db.asSystem()` to bypass, justify in a comment) · `ctx.settings` · `ctx.files` · `ctx.emit(name, payload)` · `ctx.jobs.enqueue(name, payload)` · `ctx.notify({to, template, channel})` · `ctx.log`.
Never: open DB connections, read env vars, resolve the university yourself.

## Events
Name `<module>.<entity>.<past-verb>`. Payload = IDs + few needed fields. Delivered at least once → handlers idempotent. Never cross universities. No dependency cycles: if A depends on B, B must not listen to A — A calls B's API (`ctx.call("b.createDemand", …)`).

## Commands
`edulab dev` local stack + site "demo" · `edulab install-module demo <module>` (re-run after schema change) · `edulab test` · `edulab release <version>`.

## Release checks (all must pass)
valid manifest + schemas · install twice = no change · upgrade from previous version with data · every entity has permissions · no cross-module imports/queries · only declared events · pii marked · no secrets/university names/URLs · tests pass · security scan + VAPT · README sections filled · CHANGELOG entry.

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
