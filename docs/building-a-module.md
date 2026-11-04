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
│   └── jobs/            Background jobs (bulk actions)
├── reports/             Reports and dashboard cards, one JSON file each (see "Reports and the dashboard")
├── print/               Print formats: <entity>.html for receipts, passes, hall tickets (see "Print formats and PDF")
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

### Files and images (uploads)
Marksheets, ID proofs, photos, scanned answer booklets: declare a `file` or `image` field.

```json
{ "name": "marksheet", "type": "file", "accept": ["pdf", "jpg", "png"], "maxSizeMB": 10, "pii": true },
{ "name": "photo", "type": "image", "maxSizeMB": 2, "pii": true },
{ "name": "answer_booklet", "type": "file", "accept": ["pdf"], "maxSizeMB": 150 }
```

| Key | Default | Meaning |
|---|---|---|
| `accept` | `file`: pdf, jpg, png · `image`: jpg, png | Allowed kinds. Checked by the file's **content**, not its name: a `.pdf` that isn't a PDF is refused. |
| `maxSizeMB` | 5 | Largest file for this field, up to **200**. Keep it small for photos; raise it for scans (an OSM booklet: 150). |

- **Uploading:** on the form, a *Files* box appears once the record is saved: choose a file, *Upload* (or *Replace*). API:
  `POST /api/<module>/<entity>/<id>/files/<field>` as `multipart/form-data` with the file in `file`; it returns the updated record.
- **Downloading:** `/files/<key>` in the portal, `GET /api/_files/<key>` for apps. The field's value is that key.
  Downloads can resume (HTTP Range).
- **Never public.** A file is served only to someone who may read the record it was uploaded to (roles, `onlyOwn`,
  `scope`). There is no public link to share or guess.
- **Only by uploading.** A file field can't be set by typing a key in JSON or CSV, so a record can't borrow another
  record's file.
- **Workflows apply.** Uploading counts as editing: it is blocked when the record is locked in its state. A guard can
  require a file before a step: `if (!application.marksheet) throw new Error("Upload the marksheet first")`.
- Personal documents get `"pii": true`.
- **Big files and weak connections:** the portal uploads in 5 MB pieces. If the connection drops it retries by
  itself; if the page is closed or reloaded, choosing the same file again continues where it stopped, with a progress
  bar. Apps can do the same with any [tus](https://tus.io) client: endpoint `/_upload/`, metadata `entity`
  (`<module>/<entity>`), `id`, `field`, `filename`. The same checks apply before any bytes are accepted.
- **Photos are shrunk in the browser** before upload: at most 1600 px on the longest side for `image` fields
  (2400 px for photos of documents in `file` fields), JPEG quality 85. A 9 MB phone photo becomes about 300 KB, and
  hidden data in phone photos (location, camera) is removed. PDFs are never changed.

Not yet: Word/Excel files, virus scanning, files larger than 200 MB, reading file content from hooks.

### Verify with DigiLocker
Instead of asking students to upload scans, fetch the documents straight from their DigiLocker, signed by the issuing
government department. Map DigiLocker documents to your file fields in the entity JSON:

```json
"digilocker": {
  "aadhaar": "id_proof",
  "apaar": "apaar_card",
  "class_x": "marksheet_10",
  "class_xii": "marksheet_12",
  "verified": "documents_verified"
}
```

| Key | Document |
|---|---|
| `aadhaar` | Aadhaar card (PDF) |
| `apaar` | APAAR ID (Academic Bank of Credits) |
| `class_x` / `class_xii` | Class X / Class XII marksheet |
| `verified` | Optional `check` field ticked when every mapped document has arrived |

Each mapped field must be a `file` field that accepts PDF. Map only what you need.

What happens: the record shows **Verify with DigiLocker**. The student signs in to DigiLocker (their own OTP) and
allows sharing; Bench fetches the signed PDFs and stores them in your fields like uploads (private, content-checked,
in the record's history) and ticks `verified`. If the tab is closed early, Bench finishes in the background.
Nobody can tick `verified` by hand, so a workflow guard can rely on it:
`if (!application.documents_verified) throw new Error("Verify the documents with DigiLocker first")`.
Workflow locks apply. No student names or numbers are sent to the verification service.

### Workflows: steps, approvals and who may move a record forward
Most records go through steps: an application is submitted, documents are checked, an offer is made. Declare the
steps in the schema file and the platform enforces them. You don't write workflow code.

```json
"workflow": {
  "field": "status",
  "start": "Draft",
  "edit": { "Draft": ["admission:applicant"], "Sent back": ["admission:applicant"] },
  "actions": [
    { "name": "Submit",           "from": ["Draft", "Sent back"], "to": "Submitted",          "roles": ["admission:applicant"] },
    { "name": "Verify documents", "from": ["Submitted"],          "to": "Documents verified", "roles": ["admission:verifier"] },
    { "name": "Send back",        "from": ["Submitted"],          "to": "Sent back",          "roles": ["admission:verifier"], "comment": "required" },
    { "name": "Reject",           "from": ["Submitted"],          "to": "Rejected",           "roles": ["admission:verifier"], "comment": "required" },
    { "name": "Make offer",       "from": ["Documents verified"], "to": "Offered",            "roles": ["admission:admin"] }
  ]
}
```

| Key | Meaning |
|---|---|
| `field` | A `select` field; its `options` are the states |
| `start` | The state every new record starts in |
| `actions` | Each step: `name` (the button), `from` (states it can be used in), `to`, `roles` who may use it, optional `comment`: `"required"` or `"optional"` |
| `edit` | Optional. Which roles may edit the record's other fields in each state. States not listed are read-only for everyone. Leave `edit` out to never lock. |

What the platform does:
1. **The state field is never typed in.** It changes only through actions. Create/update calls that try to set it are rejected (Data Import may set it, for migrating old records).
2. **Buttons per role.** On the form, each user sees only the actions their roles may use in the record's current state, with a comment box where needed. The same actions are in the API: `POST /api/<module>/<entity>/<id>/actions/<action>` (the action name in lower case with dashes, e.g. `verify-documents`), body `{ "comment": "…" }`.
3. **Locked fields per state** (`edit`). After *Submit*, the applicant can't change the application.
4. **Timeline.** Every step is recorded (who, when, from, to, comment) and shown on the form; `GET /api/<module>/<entity>/<id>/timeline`.
5. **An event per state reached:** `<module>.<entity>.<state>`, e.g. `admission.application.documents_verified`. Declare it in `events.emits` and other modules can react: Fees raises the fee demand, notifications go out.

**Rules JSON can't express go in a guard** in `src/hooks.ts`. Throw an error to block the step; the message is shown to the user:
```ts
import { before } from "@edulab/core";
before("application.Submit", async (ctx, application) => {
  const docs = await ctx.db.admission.application_document.find({ application: application.id });
  if (docs.length < 4) throw new Error("Upload all 4 mandatory documents before submitting");
});
```
`before("<entity>.<Action name>")` must name a declared action. Document-by-document checking works the same way: give
`application_document` its own small workflow (Pending → Verified / Rejected), and guard *Verify documents* on the
application until every document is Verified.

### Reports and the dashboard
A report counts or adds up the records of one of your entities, grouped by a field. Put one JSON file per report in
`reports/` (the file name is the report's name). No code: the platform draws the bar chart and table, adds filters,
CSV and PDF downloads, and lists the report under your module on the home page.

```json
// reports/visitors_by_purpose.json
{
  "title": "Visitors by purpose",
  "entity": "visitor_pass",
  "groupBy": "purpose",
  "measures": [{ "fn": "count", "label": "Visitors" }],
  "filters": ["status", "in_time"],
  "dashboard": true
}
```

| Key | What it does |
|---|---|
| `entity` | One of your entities. |
| `groupBy` | Optional. A field (text, select, link, check, number, date, datetime). Dates can be bucketed: `"in_time:day"`, `":month"`, `":year"`. Without `groupBy` the report is a single number (a total). |
| `measures` | One or more of `{"fn": "count"}` or `{"fn": "sum" \| "avg" \| "min" \| "max", "field": "<number, money or decimal field>"}`; `label` optional. Money shows in rupees. |
| `filters` | Fields the user can filter by: select, link and check become dropdowns; date and datetime become *from* / *to* dates. |
| `where` | Optional fixed filter, e.g. `{"status": "Inside"}` for "Inside the campus now". |
| `chart` | `"bar"` (default) or `"none"`. |
| `dashboard` | `true` puts the report on the university's home page as a card (the number, or a small chart). Use it for the two or three things people check every day. |
| `description` | Optional line shown above the report. |

- **Everyone sees only their own rows.** A report counts only the records the viewer may read (the same `onlyOwn`
  / `scope` rules as the list screen). A warden's report covers their hostel; a student's covers only themselves.
  People who can't read the entity don't see the report at all.
- URLs: screen `/r/<module>/<report>`, data `GET /api/_reports/<module>/<report>` (JSON), `.../csv`, PDF
  `/r/<module>/<report>/pdf`. Filters are query parameters: `?status=Inside&in_time_from=2026-11-01&in_time_to=2026-11-30`.
- At most 500 groups are shown. Need something a report can't express (joins across entities, a fixed layout)?
  Ask Edulab before writing a custom page.

### Print formats and PDF
Every record has **Print** and **Download PDF** links. Without a print format the platform prints every field (and
child tables as tables). For a receipt, pass, hall ticket or certificate, add `print/<entity>.html`:

```html
<!-- print/visitor_pass.html -->
<header><strong>{{site.name}}</strong><span>Visitor pass #{{id}}</span></header>
<table class="kv">
  <tr><th>Visitor</th><td>{{visitor_name}}</td><td rowspan="3">{{photo}}</td></tr>
  <tr><th>Meeting</th><td>{{whom_to_meet}}</td></tr>
  <tr><th>In time</th><td>{{in_time}}</td></tr>
</table>
<footer>Printed {{today}}</footer>
```

- `{{field}}` shows the value the way screens do: rupees for money, dates in the site's time, the name of a linked
  record, Yes/No, an image field as the picture. Values are always escaped (safe to print anything a user typed).
- `{{#lines}} … {{/lines}}` repeats its contents for each row of a `table` field; inside it, `{{field}}` means the
  child row's fields. Also available: `{{site.name}}`, `{{id}}`, `{{today}}`.
- Plain HTML and CSS only (A4 page; classes `kv` and `lines` give bordered tables). No scripts, no event handlers,
  no images or fonts from the internet: print pages and PDFs load nothing from outside.
- The checker refuses unknown `{{names}}`, unclosed sections, scripts, and files not named after one of your entities.
- URLs: `/m/<module>/<entity>/<id>/print` and `/m/<module>/<entity>/<id>/pdf`; only for users who may read the record.

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
| `ctx.log` | Logs tagged with site and module. Shows in your terminal while you develop; on live sites, use errors (below), not logs. |
| `ctx.notify.email({...})`, `ctx.notify.whatsapp({...})` | Send an email or WhatsApp message through Edulab's messaging service (Omni). See *Notifications* below. |

### Events

- **No dependency cycles.** If A depends on B, B never listens to A. A calls B's API instead (e.g. Admission calls `fees.createDemand`; OSM calls `exam.submitMarks`).

- Name: `<module>.<entity>.<past-tense verb>`, e.g. `hostel.allotment.created`.
- The payload holds IDs and the few fields a listener needs, not whole records.
- Events are delivered **at least once**. Handlers must be safe to run twice.
- An event never leaves the university it was raised in.

### Notifications (email, WhatsApp)
Tell people when something happens: the host when their visitor arrives, a student when documents are verified.
Declare the channels in `manifest.json`, then send from a hook:

```json
"notifies": ["email", "whatsapp"]
```
```ts
on("admission.application.documents_verified", async (ctx, event) => {
  const [app] = await ctx.db.admission.application.find({ id: event.id });
  await ctx.notify.email({
    to: app.email,
    subject: "Your documents are verified",
    html: `<p>Dear ${app.first_name}, your documents are verified. Please pay the admission fee by …</p>`,
  });
  // or a template designed in Omni: ctx.notify.email({ to, template: "adm-docs-verified", variables: { name: app.first_name } })
  await ctx.notify.whatsapp({ to: app.mobile, template: "docs_verified", params: [app.first_name] });
});
```

- **Sent only if the hook succeeds.** The message is queued in the same transaction as your hook's changes, and sent
  right after they are saved. If your hook fails, nothing is sent. Failed sends are retried (5 attempts).
- **WhatsApp needs a Meta-approved template**: ask Edulab to get it approved in Omnichannel; `params` fill its
  placeholders in order. SMS is not available.
- **The university sees everything** that was sent, to whom and whether it was delivered, under *Notifications* in
  their portal.
- **Dev and test sites never message real people.** On the dev server every message goes to Edulab's test address;
  the log shows the real recipient and where it actually went. Real sending is switched on only for a university's
  live site.
- Use recipients from the record (`app.email`), never addresses typed into a free-text field by someone else.

## 7. Develop, test, release

### Check while you work

```bash
node scripts/validate.mjs        # silent = OK; otherwise it lists every problem
```
Claude Code runs this checker after every edit (see `.claude/settings.json`).

### Try it on a dev site before releasing (branch previews)
You don't need to release to see your module working. Edulab gives your team a dev site (for example
`https://hostel.dev.digitalvarsity.org`) and turns on a **branch preview** there for your module and branch.

1. Push to your branch: `git push origin main` (or any branch you agreed with Edulab).
2. Within about **2 minutes** the dev bench fetches that commit, runs the contract checker, and installs it on
   **your dev site only**: new tables and fields, screens, API and hooks.
3. Open your dev site and try it. Every other site keeps the approved version.

| You see | Meaning |
|---|---|
| The change on your dev site | The preview is live (on GitHub: a ✓ `edulab/preview` on the commit) |
| No change after 3 minutes | The commit failed the checker or the install. Ask for the error, or check the ✗ on GitHub. Fix it and push again. |

A preview is not a release. It needs no version bump, tag or review, and it never reaches prod. When it works,
release it the normal way (below). Fields you add in a preview stay in the dev site's database; to start clean,
ask for the dev site to be reset.

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

### Dev and prod: where your module runs
Edulab runs two separate copies of the platform. They have different databases, logins and marketplaces.

| | **Dev** | **Prod** |
|---|---|---|
| Who uses it | Developers and testers | Universities: real students, real fees |
| Address | `<site>.dev.digitalvarsity.org` | `<site>.digitalvarsity.org` |
| Your release | Every tag you push lands here first: checks, review, approval | Only versions approved on dev **and** promoted by Edulab |
| Data | Sample data; sites can be thrown away | Real data, backed up nightly |

1. You push a tag, and the release is checked and reviewed on **dev** (section 8).
2. Once approved, it is installed on a dev site and tested there, by you and by Edulab's testers.
3. Edulab **promotes** it to prod. Universities then upgrade to it from their control plane.

You never release straight to prod, and nothing on dev can touch prod data. A version is promoted unchanged: what
was approved on dev is exactly what runs on prod. Errors (below) are recorded separately on dev and on prod, so
you get one developer error link for each.

### Errors and crash reports (seeing what broke on live sites)
Like crash reports in an app store: when your module fails on **any** university's site, Edulab records it and you can see it. You don't add any code for this.

**While you develop:** `console.log` and `ctx.log(...)` print in your terminal as usual. A thrown error shows its full stack trace there.

**On live sites, two things are recorded automatically:**
| What failed | Recorded as |
|---|---|
| One of your hooks (`on("fees.payment.received", …)`) throws | `hook` · `on("fees.payment.received")` |
| A request to one of your entities or endpoints ends in a server error (500) | `http` · `GET /api/:mod/:ent` |

Wrong input (a 400 such as "amount must be a whole number") is your module working as designed, so it is **not** recorded.

Each report has: your module **version**, where it failed, the error message, the **stack trace** down to your file and line (`noticeboard/0.3.0/src/hooks.ts:4`), which sites hit it, and how many times. Reports of the same bug are grouped into **one row**, so 500 failures from one bug show up as one row with a count, not 500 alerts. A failed hook is retried up to 10 times, and each retry counts.

**Where you see them:**
1. **Your developer error link.** An Edulab admin makes one for your module (Marketplace → your module → *Developer error link*) and sends it to your team. It lists every error of **your module only**, from every site; click a row for the stack trace and the latest occurrences. Keep it private: anyone with the link can read your module's errors. If it leaks, ask for a new one, which stops the old link. The same data is available as JSON: `GET https://admin.digitalvarsity.org/api/dev/errors?module=<name>` with the header `x-error-key: <key>`, and `/api/dev/errors/<id>` for one error.
2. **A GitHub issue on your repo** is opened the first time a new kind of error appears, with the version and stack trace. (Being switched on; until then, use the link.)
3. The university's own admin sees a short list of what failed on their site (no stack traces) under **Error log** in their portal, so expect them to report it too.

**No student data in reports.** Request bodies and record values are never stored. Emails, phone numbers, long numbers and quoted values are masked in messages (`Key (prn)=(<value>)`). Write error messages that say *what* went wrong, not *who*: `throw new Error("room has no free bed")`, never `"Arjun Verma has no bed"`.

**Fixing:** reproduce it locally, fix it, then release the next patch version (`0.3.0` → `0.3.1`, see *Release a version*). After the fix is approved and sites move to it, new reports stop, and the version column shows which versions still fail.

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

## 13. Accessibility: everyone must be able to use it
Indian law requires university portals to be usable by people with disabilities: the RPwD Rules (rule 15, amended
2023) make **IS 17802** (equivalent to **WCAG 2.1 level AA**) mandatory, the UGC accessibility guidelines apply it to
universities, and **GIGW 3.0** adds the government website rules. Bench builds this into every screen it generates;
your module keeps it that way by describing things clearly.

### What the platform already does for every module
- Screens work with the keyboard alone, start with *Skip to main content*, and have one page heading and labelled navigation.
- Every field is announced with its label; required fields are marked for screen readers; a failed save keeps what the user typed and lists each problem with a link to the field.
- Colours meet contrast rules on every theme (the theme checker refuses colours that don't); focus is always visible.
- On phones, lists become cards, buttons are large enough to tap, and Save stays at the bottom of the screen.
- Text can be enlarged (A / A+ / A++ in the footer, or browser zoom to 200 %) without losing content.
- Upload progress and errors are announced; Delete asks for confirmation.
- Every site has a public **Accessibility statement**, **Screen reader access** page and **Help** page (footer links).

### What you must do in your module

| Do | Why |
|---|---|
| Give every field and entity a clear `label` in plain words ("Date of birth", not "dob_dt") | Screen readers read the label aloud; it's also the column title on phones |
| Name workflow actions as verbs ("Verify documents", "Send back") | They become buttons; a button must say what it does |
| Write guard errors that say what to fix: `"Upload the marksheet before submitting"` | Shown to the user and read by screen readers |
| Don't make meaning depend on colour or symbols alone; option names carry the meaning ("Rejected", not "Red") | Colour-blind and screen reader users |
| In emails you send (`ctx.notify.email`), use headings and real text, not text inside images; give images `alt` text | Emails must be accessible too |
| Don't put essential instructions only inside an uploaded PDF or image | Scans are not readable by screen readers |

Check your module on your dev site with the keyboard only (Tab, Shift+Tab, Enter, Space) and on a phone. An automatic
accessibility check (axe-core) is being added to the marketplace checks.

## 14. Languages: Hindi, Marathi and more (coming)
Universities will choose their languages (English plus Hindi, Marathi…), and each person picks theirs. Government sites
must be at least bilingual (GIGW 3.0). The design is decided; the platform part is being built. What it means for you:

- **Stored values never change with the language.** Option values, workflow states, the API, CSV files, events and
  hooks stay in the English you wrote. Only what is *shown* is translated. So keep option values stable and meaningful.
- **Your module ships translations** in `i18n/<language>.json`, mirroring your schema:
  ```json
  { "status": "reviewed",
    "entities": { "visitor_pass": {
      "label": "आगंतुक पास",
      "fields": { "status": { "label": "स्थिति", "options": { "Waiting": "प्रतीक्षा में", "Inside": "अंदर" } } },
      "actions": { "Allow entry": "प्रवेश दें" } } } }
  ```
  A missing translation shows the English text. The checker refuses a translation for a field or option that doesn't
  exist (so renaming a field can't leave a stale translation). `status` is `machine-draft` or `reviewed`: machine
  drafts (made with Bhashini or IndicTrans2 from your labels only, never from student data) must be reviewed by a
  native speaker before a university switches the language on.
- **Universities can correct a translation** for their site without waiting for your next release.
- Until this ships: write labels in clear, simple English; avoid abbreviations and jargon, which translate badly.

## 15. Questions

Open an issue in this repo, or raise it in the Multi-Tenancy meeting. Changes to this contract are recorded in `docs/decisions/`.
