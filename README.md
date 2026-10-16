<!--
This file becomes your module's page in the Edulab marketplace.
Fill in every section; review rejects empty ones. Delete this comment.
How to build a module: docs/building-a-module.md in the edulab-bench repo.
-->

# Hostel Management

One line on what this module does for a university.
*Example: Room inventory, applications and allotments for university and college hostels.*

## Who uses it

| Role | Can do |
|---|---|
| `hostel:admin` | Manage hostels, rooms and all allotments |
| `hostel:warden` | Manage allotments for assigned hostels |
| `hostel:student` | Apply for a room, see own allotment |

## What it does

- Short list of the main features, in the words a university admin uses.

## Needs

- **Core:** 1.x
- **Modules:** Fees 1.x (hostel fee must be paid before a room is allotted)

## Setup after install

1. Steps the university admin follows, with the setting names from `manifest.json`.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Rooms per student | 1 | Maximum active allotments per student |
| Allot only after hostel fee is paid | Yes | Wait for the Fees payment event before allotting |

## Events

| Emits | When |
|---|---|
| `hostel.allotment.created` | A room is allotted |
| `hostel.allotment.vacated` | A student leaves a room |

| Listens to | Does |
|---|---|
| `fees.payment.received` | Allots the requested room when the hostel fee is paid |

## Personal data

Fields marked `pii`: guardian phone (allotment).

## Support

Publisher, contact, and where to report problems.
