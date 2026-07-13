# GEDCOM and Cloud Notes

## GEDCOM

GEDCOM is the common genealogy exchange format used by many family tree tools. OpenTree should support it because it lets users import from or export to other tools without being locked in.

Recommended phases:

1. Export basic people and parent/partner relationships.
2. Import basic people and relationships into a new project.
3. Add events, places, sources and media references.
4. Validate round trips against common tools.

## External Contributions

Before full accounts or sync, OpenTree can accept outside input through simpler flows:

- Google Forms or CSV import into `contributions`.
- Email attachments containing a contribution file.
- Shared read-only PDF/image exports for relatives.
- A review inbox where the tree owner approves each suggestion.

## Optional Cloud

A future cloud service should be an adapter, not a dependency:

- local data remains usable offline;
- every sync operation is explicit and visible;
- conflict resolution is human-reviewable;
- private living-person data can be excluded from public exports.
