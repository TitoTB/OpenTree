# OpenTree Architecture

## Principles

OpenTree is local-first. A user can install it, create a tree, add media, print/export, and reopen everything without internet access. Online features are optional helpers, never the source of truth.

## Project Folder

A future real OpenTree project should be a folder:

```text
My Family.opentree/
  opentree.sqlite
  media/
    people/
    documents/
  imports/
  exports/
  backups/
  manifest.json
```

`manifest.json` stores non-sensitive project metadata: title, locale, app schema version, created date, and last opened date. The SQLite database stores the tree itself.

## App Layers

- `src/domain`: TypeScript domain types shared by UI and services.
- `src/data`: demo data and schema-oriented constants.
- `src/services`: project persistence, later backed by Tauri SQLite and file APIs.
- `src/components`: feature components.
- `src/i18n`: local UI strings.
- `src-tauri`: desktop shell, migrations, permissions and updater-ready config.

## Persistence Phases

1. Browser storage prototype: lets us build the product quickly and validate the tree experience.
2. Tauri project folder: create/open folders, initialize SQLite, copy media into `media/`.
3. Import/export: GEDCOM, CSV contribution forms, PDF/image output.
4. Optional sync: explicit cloud account or user-owned storage, with local database remaining primary.

## Cloud Position

Cloud is useful for collaboration, backups and public sharing, but it should not be required. The recommended future shape is a sync adapter:

- Local SQLite remains canonical for offline work.
- The cloud receives versioned change events.
- Incoming contributions become reviewable suggestions before touching the tree.
- Users can opt out completely.
