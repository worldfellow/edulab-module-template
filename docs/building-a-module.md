# Building an Edulab module

This is the guide for anyone who builds a module: Edulab product teams now, outside partners later through the marketplace. If you follow it, your module installs on any university site, works with every other module, and passes marketplace review.

> **Status: contract v0 (proposed).** The core and the `edulab` CLI are not built yet. This document is the contract they will implement. Team leads review it before the first module (Hostel) is built against it. Changes go through `docs/decisions/`.

---

## 1. What a module is

A module is one product feature set (Hostel, Exam, Fees, Library…) packaged so a superadmin can **install it on a university site with one click**.

When a module is installed on a site, the platform:

1. creates the module's tables in **that university's own database**,
2. adds the module's roles to **that university's login** (Keycloak realm),
3. loads the module's default data (fixtures),
4. turns on the module's API, screens and event handlers for that site only.

Your module never deals with "which university is this?". The core answers that on every request, job and event. You write the module as if there were only one university.

## 2. The golden rules

These are checked in review. A module that breaks one is rejected.

1. **Describe data, don't hand-build it.** Every table is a JSON file in `schema/`. The core creates the table, its API, its admin screens, its audit log and its migrations from that file.
2. **Never touch another module's tables.** Read core data (student, college…) through `link` fields. Talk to other modules only through **events** or their published API.
3. **Never import another module's code.** Not even a helper.
4. **Default deny.** A role can do nothing on an entity until the schema grants it.
5. **No secrets, no university names, no hard-coded URLs** in the code. Per-university values are **settings**.
6. **Mark personal data.** Any field holding personal data gets `"pii": true` (used for export, archival and deletion requests).
7. **Every change is re-runnable.** Install, upgrade and migrations may run twice; the second run must change nothing.

## 3. Folder layout

Start from this [module template repo](https://github.com/worldfellow/edulab-module-template): on GitHub click **Use this template** (later: `edulab new-module <name>`). You get this:

```
hostel/
├── manifest.json        Who the module is: name, version, needs, roles, events, settings
├── README.md            The marketplace page: what it does, who uses it, how to set it up
├── CHANGELOG.md         One entry per released version
├── schema/              One JSON file per entity (table)
│   ├── room.json
│   └── allotment.json
├── fixtures/            Default data loaded on install (room types, master lists)
├── src/
│   ├── hooks.ts         Event handlers (the events listed under "listens")
│   ├── api/             Extra endpoints beyond the automatic ones
│   └── jobs/            Background jobs (reports, bulk actions)
├── pages/               Custom screens beyond the automatic list/form screens
├── migrations/          Only for data moves the schema can't express
├── import/              Mappers that bring data in from the old Edulab product (see section 10)
└── tests/
```

Most modules need only `manifest.json`, `README.md`, `schema/` and a few hooks. Add `api/`, `jobs/`, `pages/` and `migrations/` only when the automatic parts aren't enough. `import/` is needed only for modules that replace an existing Edulab product.

## 4. `manifest.json`

```json
{
  "name": "hostel",
  "title": "Hostel Management",
  "version": "0.1.0",
  "publisher": "Edulab",
  "core": ">=1.0.0 <2.0.0",
  "dependsOn": { "fees": ">=1.0.0" },
  "roles": {
    "hostel:admin":   "Manages hostels, rooms and allotments",
    "hostel:warden":  "Manages allotments for assigned hostels",
    "hostel:student": "Applies for a room and sees own allotment"
  },
  "events": {
    "emits":   ["hostel.allotment.created", "hostel.allotment.vacated"],
    "listens": ["fees.payment.received"]
  },
  "settings": {
    "maxRoomsPerStudent": { "type": "number", "default": 1, "label": "Rooms per student" },
    "allotmentNeedsFee":  { "type": "check",  "default": true, "label": "Allot only after hostel fee is paid" }
  },
  "price": { "plan": "per-student-per-year" }
}
```

| Field | Rule |
|---|---|
| `name` | Lowercase, one word or `kebab-case`. Unique in the marketplace. Becomes the database section name (`-` becomes `_`), URL prefix and role prefix. |
| `version` | Semantic versioning. Patch = fixes; minor = new things, nothing removed; major = something removed or changed meaning. |
| `core` | Core versions this module works with. |
| `dependsOn` | Other modules that must be installed first. Keep this short; every dependency limits who can buy your module. |
| `roles` | Always `<module>:<role>`. Each role has a one-line description shown to the university admin. |
| `events` | Everything you emit or listen to. Undeclared events are blocked at runtime. |
| `settings` | Values each university can change from its admin screen. Read them with `ctx.settings`. |
| `optionalDependsOn` | Modules you react to **if** the university has them (listen to their events), but don't require. No links to them. Example: HRMS listens to `recruitment.candidate.selected`. |
| `secrets` | Names of secrets your module needs (e.g. `gateway.api_key`). The superadmin sets them per university; read with `ctx.secrets.get()`. Never in settings or code. |
| `publicRoutes` | Routes that work without login, e.g. a payment gateway callback `/payments/callback/:provider`. The handler must verify the caller's signature. Reviewed by hand. |

## 5. Schema files: one per entity

`schema/allotment.json`:

```json
{
  "name": "allotment",
  "label": "Room Allotment",
  "naming": "ALT-{YYYY}-{#####}",
  "trackChanges": true,
  "fields": [
    { "name": "student",  "type": "link", "to": "core.student", "required": true },
    { "name": "room",     "type": "link", "to": "hostel.room",  "required": true },
    { "name": "from",     "type": "date", "required": true },
    { "name": "to",       "type": "date" },
    { "name": "status",   "type": "select", "options": ["Requested", "Allotted", "Vacated"], "default": "Requested" },
    { "name": "guardian_phone", "type": "phone", "pii": true }
  ],
  "unique": [["student", "from"]],
  "permissions": {
    "hostel:admin":   ["read", "create", "update", "delete"],
    "hostel:warden":  ["read", "create", "update"],
    "hostel:student": { "actions": ["read", "create"], "onlyOwn": "student" }
  }
}
```

From this one file the core gives you, on every site where the module is installed:

- the table `hostel.allotment` (section `hostel`, table `allotment`) in that site's own database, with real foreign keys for links and indexes for `unique`,
- an API: `GET/POST /api/hostel/allotment`, `GET/PATCH/DELETE /api/hostel/allotment/:id`, with filters and paging,
- a list screen and a form screen in the site portal,
- permission checks per role, including `onlyOwn` (a student sees only rows where `student` is themselves),
- a change history (who changed what, when) when `trackChanges` is on,
- IDs in the `naming` pattern,
- **automatic migrations**: add a field to the JSON and the next install or upgrade adds the column on every site.

### Who sees which rows

Each role in `permissions` is either a list of actions, or an object that also limits **which rows**:

| Option | Means | Examples |
|---|---|---|
| `"onlyOwn": "<link field>"` | Only rows about the user themselves: the link points at their `core.user`, their `core.student`, or a record of this module with a `user` link (employee, evaluator, candidate). Parents see their linked students' rows. | Student sees own exam form; employee sees own payslip |
| `"scope": "<link field or path>"` | Only rows in what the site admin has **assigned** to the user (colleges, hostels, departments, students…). Paths follow links: `"room.hostel"`. | College admin sees only their colleges; warden only their hostels; HOD only their department; agent only their students |

```json
"permissions": {
  "hostel:warden":  { "actions": ["read", "update"], "scope": "room.hostel" },
  "hostel:student": { "actions": ["read", "create"], "onlyOwn": "student" }
}
```

Assignments are core data (`core.user_scope`), managed by the site admin. Your module never stores "which colleges does this user have".

### Field types

| Type | Stores | Notes |
|---|---|---|
| `text`, `longtext` | Text | `maxLength` optional |
| `number`, `decimal` | Numbers | `min`, `max` optional |
| `money` | Amount in paise | Never use `decimal` for money |
| `check` | Yes / no | |
| `date`, `datetime`, `time` | Dates and times | Stored in UTC, shown in site timezone |
| `select` | One of `options` | |
| `link` | Reference to another entity | `to`: `core.<entity>`, `<this module>.<entity>`, or an entity of a module in `dependsOn` |
| `table` | Child rows | `of`: another schema in this module (e.g. room → beds) |
| `file`, `image` | Uploaded file | Stored in the site's own file folder; `private` by default |
| `email`, `phone` | Validated contact | Usually `pii` |
| `json` | Free-form data | Avoid; it can't be filtered or validated |

### Core entities you can link to

`core.user`, `core.student`, `core.college`, `core.faculty`, `core.department`, `core.programme`, `core.subject`, `core.academic_year`.

*Programme* is a degree programme such as B.Sc. Computer Science (it has semesters). *Subject* is one paper. Semester is stored as a number. Full field list: [core-entities.md](core-entities.md).

Core events any module may listen to: `core.student.created`, `core.student.updated`, `core.user.created`.

These belong to the core. Your module reads them and links to them; it never copies them into its own tables. When a student's email changes, it changes once, in the core, for every module.

### Where your data lives

Every university has its own Postgres database. Inside it, each owner has its own section (Postgres schema):

```
db: site_<university>
├── core.*       shared data: student, college, programme, course, subject, academic_year, user
├── hostel.*     your module's tables, created when your module is installed on this site
├── fees.*       other installed modules
└── platform.*   installed modules, migration history, audit log, event outbox, import ID map
```

Your module connects as its own database role, and the database itself enforces the boundaries:

| Section | Your module can |
|---|---|
| your own (`hostel.*`) | read and write |
| `core.*` | read; write only through the core API with the right permission (e.g. Admission creates students) |
| modules in your `dependsOn` | read |
| any other module | nothing |
| `platform.*` | nothing directly; the core uses it for you |

`link` fields are real foreign keys, so a link always points at a row that exists, and screens can join across sections.

## 6. Code: the parts the schema can't do

Every piece of module code receives a `ctx` from the core. You never open a database connection, read an env variable or work out the university yourself.

```ts
// src/hooks.ts
import { on } from "@edulab/core";

// Declared in manifest.events.listens
on("fees.payment.received", async (ctx, event) => {
  if (event.purpose !== "hostel") return;
  await ctx.db.hostel.allotment.update(
    { student: event.student, status: "Requested" },
    { status: "Allotted" },
  );
  await ctx.emit("hostel.allotment.created", { student: event.student });
});
```

What `ctx` gives you:

| | |
|---|---|
| `ctx.site` | The current university (code, name, timezone). Read-only. |
| `ctx.user` | The logged-in user and their roles. |
| `ctx.db` | Typed access to your module's entities and core entities. Permissions applied unless you call `ctx.db.asSystem()`. |
| `ctx.settings` | This university's values for your manifest settings. |
| `ctx.files` | Upload, download and signed links in the site's file folder. |
| `ctx.emit()` | Publish an event declared in `emits`. |
| `ctx.jobs.enqueue()` | Run a job in `src/jobs/` in the background. |
| `ctx.notify()` | Email / SMS / WhatsApp through the central communication service. |
| `ctx.log` | Logs tagged with site and module. |

### Events

- **No dependency cycles.** If A depends on B, B never listens to A. A calls B's API instead (e.g. Admission calls `fees.createDemand`; OSM calls `exam.submitMarks`).

- Name: `<module>.<entity>.<past-tense verb>`, e.g. `hostel.allotment.created`.
- The payload holds IDs and the few fields a listener needs, not whole records.
- Events are delivered **at least once**. Handlers must be safe to run twice.
- An event never leaves the university it was raised in.

## 7. Develop, test, release

### Check while you work

```bash
node scripts/validate.mjs        # silent = OK; otherwise it lists every problem
```
Claude Code runs this checker after every edit (see `.claude/settings.json`).

### Release a version

1. Bump `version` in `manifest.json` (e.g. `0.1.0` → `0.2.0`, see the version rules in section 4).
2. Add a `## 0.2.0` entry to `CHANGELOG.md` saying what changed.
3. Run `node scripts/validate.mjs`, then commit and push to `main`.
4. Tag the release and push the tag:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

That is the whole submission. Within about 2 minutes the Edulab control plane sees the new tag and runs the marketplace checks (section 8) on exactly that commit:

| Result | What happens | What you do |
|---|---|---|
| **Failed** | One or more checks failed. | Read the report, fix, bump to the next patch version (`0.2.1`) and tag again. |
| **Waiting for review** | All checks passed. An Edulab reviewer reads the report and the changes since your last approved version. | Nothing; wait. |
| **Rejected** | The reviewer wrote why. | Fix, bump to the next patch version and tag again. |
| **Approved** | The version is frozen and listed in the marketplace. Universities can install it, and sites that have an older version can upgrade. | Nothing. |

Until results show on your GitHub commit as a ✓ or ✗ (`edulab/marketplace`), your team lead or the reviewer shares the report with you.

### Tag rules

- The tag is `v` + the exact `version` in `manifest.json`: `v0.2.0` ↔ `"0.2.0"`. Anything else fails.
- Every tag must be **newer** than the last approved version. A version number is used once: after a failure or a rejection, tag the next patch, never the same number again.
- Never move or delete a pushed tag.
- Removing an entity or a field needs a new **major** version (`1.x` → `2.0.0`).
- Every module in `dependsOn` must already be approved in the marketplace.
- Only tags like `v1.2.3` are picked up; other tags (`test`, `v1.2`) are ignored.

The `edulab` command-line tool (`edulab dev`, `edulab release 0.2.0`, …) will wrap these steps; until it exists, use the commands above.

## 8. Marketplace checks

Run on every release. Any failure blocks it.

Running today:
- [x] `manifest.json` and every schema file are valid (the contract checker, Edulab's own copy).
- [x] The module name matches the registered repo; the tag matches the manifest version and is newer than the last approved one.
- [x] Nothing removed without a major version; every dependency is in the marketplace.
- [x] Installs on an empty site, and installing a second time changes nothing.
- [x] Upgrades from the last approved version.
- [x] No secrets in the code (secret scan).
- [x] `README.md` exists; `CHANGELOG.md` has an entry for this version.

Coming next (the reviewer checks these by hand until then):
- [ ] Upgrades on a site that has data.
- [ ] Every entity has `permissions`; no role has access that isn't written down.
- [ ] No import of another module's code, no query on another module's tables.
- [ ] Only declared events are emitted or handled.
- [ ] Personal-data fields are marked `pii`.
- [ ] No university names or hard-coded URLs in the code.
- [ ] Tests pass.
- [ ] Security scan and automated VAPT pass.
- [ ] `README.md` has every section of the template filled in.

## 9. Uninstall

Uninstalling removes the module's roles, screens, API and handlers from the site. **Its section is renamed to an archive and its files are kept, never deleted**, so a reinstall gets the data back. Real deletion is a separate, logged superadmin action.

## 10. Importing data

There are two ways data comes in. Both run as **import jobs** in the background and both show up in the same **Import history** screen.

| | Data Import (files) | Product migration (mappers) |
|---|---|---|
| Source | CSV or Excel uploaded by a person | An old Edulab product's database |
| Used for | Master lists, bulk updates, universities sending spreadsheets | Moving a university off Exam, Admission, Fees, SFC, LMS… |
| Module code needed | **None**, generated from `schema/` | `import/` mappers |
| Who runs it | University admin or Edulab support (needs the `import` permission) | Edulab platform team, during a migration |

### 10.1 Data Import: automatic for every entity

Every entity in `schema/` gets this in the site portal, with no code:

1. **Pick the entity** (e.g. Room) and the mode: *Insert new* or *Update existing*.
2. **Download the template** (CSV or Excel). Columns are the entity's fields; required ones are marked; `select` columns list their allowed values; child `table` rows go on extra lines under their parent.
3. **Fill and upload.** `link` columns accept the linked record's ID or any field in its `unique` (students by PRN, colleges by code), so nobody has to look up internal IDs.
4. **Preview.** The first rows are checked against the schema: missing required fields, wrong types, unknown options, links that don't match. Errors are shown per cell before anything is written.
5. **Start.** The import runs as a background job with a progress bar. Large files don't block the screen.
6. **Result.** Per row: created, updated or failed with the reason. **Download only the failed rows**, fix them, and upload that file again.
7. **History.** Every import is kept: who, when, entity, file, counts, status, the full row log. Admins can open any past import.

**Data Export** is the same in reverse: pick an entity, filter, choose fields, get a file from a background job.

To allow it, give the role the `import` and/or `export` action in the entity's `permissions`:

```json
"permissions": {
  "hostel:admin": ["read", "create", "update", "delete", "import", "export"]
}
```

Imports go through the same checks as the screens: permissions, required fields, `unique`, change history. A file can never do what the person uploading it couldn't do by hand.

### 10.2 Product migration: from the old Edulab product

Modules that replace an existing Edulab product (Exam, Admission, Fees, SFC, LMS…) bring that product's data across. The core provides the machinery: trial runs, reports, the ID map and re-runs. Your module provides only the mapping.

```
import/
├── MAPPING.md          Every old table → core / this module / other module / dropped, with reasons
├── sources.json        Which old system(s) and tables this module reads from
└── mappers/
    ├── exam_form.ts     One mapper per target entity
    └── marks.ts
```

A mapper turns one old row into one new record:

```ts
// import/mappers/allotment.ts
import { mapper } from "@edulab/core/import";

export default mapper({
  from: "legacy.hostel_allotments",      // old table
  to: "hostel.allotment",                 // new entity
  key: (row) => row.id,                   // old ID, recorded in the ID map
  map: async (row, ctx) => ({
    student: await ctx.ref("core.student", { prn: row.prn }),   // find the already-imported student
    room:    await ctx.ref("hostel.room", { legacyId: row.room_id }),
    from:    row.start_date,
    status:  { A: "Allotted", W: "Requested", V: "Vacated" }[row.status],
  }),
});
```

Rules for mappers:

- **Core data is imported by the core, before any module.** Colleges, programmes, courses, subjects, years, users and students come first, with students de-duplicated across products by PRN, then email, then mobile. Your mappers find them with `ctx.ref("core.<entity>", …)`; they never create them.
- **Modules import in dependency order:** a module's `dependsOn` modules are imported first.
- **Re-runnable.** The core records every row in `platform.import_map` (source, old ID → new ID). Running again updates instead of duplicating.
- **Reject, don't guess.** If a row can't be mapped, `throw` with a reason. It appears in the job's row log and the run continues.
- **Totals must match.** Declare checks in `sources.json` (e.g. sum of fees collected, count of declared results). The import fails if old and new totals differ.

Moving an existing university onto the platform (trial run, parallel run, cutover) is run by Edulab; your mappers are what it uses.

## 11. Checking your module


The template includes `scripts/validate.mjs`, a stand-in for `edulab validate` until the CLI exists. It checks `manifest.json` and every `schema/*.json` against this contract: naming, field types, link targets, permissions, declared roles and events, personal data, money fields. Run it any time:

```bash
node scripts/validate.mjs
```

No output means the module is valid. Otherwise it prints one line per problem, saying what to fix.

## 12. Using Claude Code (or another AI assistant)

Every module repo ships with:

- `CLAUDE.md` — about 250 words: what the module is, the layout and the rules. Loaded on every message, so it stays short.
- `.claude/skills/edulab-module/SKILL.md` — the exact formats (field types, `ctx`, events, release checks). Loaded only when Claude adds or changes something.
- The Hostel example files, which Claude copies as the pattern.
- `.claude/settings.json` — a hook that runs `scripts/validate.mjs` after every file Claude edits. When the module is valid it costs nothing; when it isn't, Claude gets only the problem lines and fixes them.

So a developer can clone the module repo and say *"add an entity for mess menus with weekly meals; wardens edit, students read"*, and Claude has the whole contract without reading this guide or the platform repo. Don't paste this guide into a chat; it costs tokens and adds nothing the skill doesn't have.

## 13. Questions

Open an issue in this repo, or raise it in the Multi-Tenancy meeting. Changes to this contract are recorded in `docs/decisions/`.
