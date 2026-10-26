# Core entities

The shared data every module links to. It lives in the `core` section of each university's database and is owned by the core; modules read it and link to it, never copy it.

**Status:** proposed v0, built from what the existing Exam, OSM, Admission, LMS, Fees, Payments, SFC, Hostel, HRMS, Recruitment and Budget code actually uses (16 Oct 2026). Field lists are the union of what those products need; trim when building.

## The entities

```
academic_year
faculty ─┬─ department
         └─ programme ── semesters (child rows)
subject ── programme, semester number
college ── programmes offered (child rows)
user ── user_scope (what this user is assigned: colleges, hostels, departments, students…)
student ── user, college, programme, guardians (child rows)
```

### `core.academic_year`
label (2026-27), start, end, is_current.
*Used by:* admission, exam, lms, hostel, fees. Budget keeps its own **financial year** (April–March), which is not an academic year.

### `core.faculty` and `core.department`
code, name, name_local · department also links to faculty.
*Used by:* admission, exam, osm, lms, fees, hrms (staff departments), budget (spending departments).

### `core.programme`
The degree programme a student is admitted to (e.g. B.Sc. Computer Science).
code, name, short_name, name_local, faculty, department, level (UG / PG / PhD / Diploma / Certificate), degree_type, display_degree_name (+ local), duration_years, number_of_semesters, pattern (e.g. CBCS / NEP), aided (aided / unaided), assessment_type (OSM / non-OSM), honours_allowed, credits_allowed, eligibility_rule, specializations (list), status.
**semesters** (child): number, code, name, max_subject_groups, is_honours.
*Replaces:* the old "course" tables in every product. There is no `core.course`; that name meant different things in different products.

### `core.subject`
One paper. code, old_code, name, short_name, name_local, programme, semester (number), credits, subject_type (core / elective / skill / …), nep_type, regular_or_honours, optional, internal max/min, external max/min, practical max/min, total_marks, lecture/tutorial/practical hours, evaluation (internal / external / both), external_method (OSM / offline), linked practical subject, specialization, board_of_studies, status.
*Used by:* exam, osm, lms, admission, sfc (transcripts).

### `core.college`
code, name, short_name, name_local, type (constituent / affiliated / autonomous), affiliation_no, aishe_code, address, city, taluka, district, state, pincode, email, phone, logo, stamp, brand_colour, latitude, longitude, geo_radius_m (LMS attendance), exam_centre_code, status.
**programmes** (child): which programmes this college offers, with intake.
*Used by:* every module.

### `core.user`
Every person who logs in: students, staff, evaluators, candidates, parents.
keycloak_id, full_name, first/last name, email, mobile, photo, active, last_login.
Roles are not stored here; they come from Keycloak.

### `core.user_scope`
What a user is assigned to, for `scope` permissions: user, entity (e.g. `core.college`, `hostel.hostel`, `core.department`, `core.student`), record. Managed by the site admin.
*Needed by:* admission and exam (college staff), hostel (wardens), budget (HODs and clerks), lms (faculty → batches), sfc (agents → students; staff → services), hrms (managers → team).

### `core.student`
Who the student is, for life. Created by **Admission** (or the importer); every other module only reads it.

| Group | Fields |
|---|---|
| Identity | prn, enrollment_no, roll_number, exam_registration_no, abc_id (+ verified), aadhaar_no (encrypted) |
| Name | first, middle, last, full, name_as_per_aadhaar, name_on_marksheet, name_local |
| Personal | dob, place_of_birth, gender, blood_group, nationality, domicile_state, religion, minority, category, sub_category, caste, disability (type flags), marital_status |
| Contact | email, mobile (+ country code), whatsapp, correspondence address, permanent address, current_location (in / outside India) |
| Family | father_name, mother_name, family_income, employment_status; **guardians** (child): name, relation, mobile, email, linked `core.user` (so parents can log in and see their children) |
| Academic | user, college, programme, current_semester, current_year, academic_year, admission_year, batch, pattern, specialization, lateral_entry, in_house (+ college), degree_type (regular / repeater / dual), gap_year |
| Activities | ncc, nss, sports, cultural |
| Status | admission_status, degree_status, passing_year, division, convocation_verified (+ at), account_status |
| Files | photo, signature |

All personal fields are marked `pii`. Aadhaar and bank-type numbers are encrypted at rest.

### Core events
`core.student.created`, `core.student.updated` (with changed field names), `core.user.created`. Example: LMS enrols new students when `core.student.created` fires; every module sees an email change once.

## Open questions for the leads

1. **Batch and division.** LMS, Exam and Fees all group students into batches and divisions. Move them into core, or keep them per module?
2. **Semester as an entity.** Today a number plus the programme's semester list. Enough?
3. **Transcripts.** Exam and SFC both have a transcript request. One owner is needed: suggested SFC (it owns document issue), reading marks from Exam's API.
4. **Student versus application data.** Admission keeps previous-exam marks, documents and preferences in its own module; only lifelong identity goes into `core.student`. Confirm the split.
