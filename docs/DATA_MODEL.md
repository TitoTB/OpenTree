# OpenTree Data Model

The model is designed for genealogy complexity and future GEDCOM support.

## Core Entities

- `trees`: a project can hold one primary tree now, more later if needed.
- `people`: human profiles with names, dates, places, notes and privacy flags.
- `relationships`: parent-child, partner/spouse, adoption, guardianship and other relation types.
- `events`: birth, baptism, residence, marriage, divorce, death, burial, immigration and custom facts.
- `places`: normalized locations that events can reference.
- `media_items`: photos, scans, audio or video stored under the project folder.
- `citations`: source references for facts and relationships.
- `contributions`: external suggestions imported from forms, email or shared files.

## Relationship Strategy

Relationships are not stored as only `mother_id` and `father_id`. A separate relationship table supports:

- multiple partners;
- divorce and relationship dates;
- adoption and non-biological parentage;
- unknown parents;
- future GEDCOM family records.

## SQLite Migration

The initial migration lives in `src-tauri/migrations/001_initial.sql`.
