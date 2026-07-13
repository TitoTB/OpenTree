import type { Person, PersonId, Relationship } from "../domain/types";

export interface TreeNode {
  person: Person;
  partners: Person[];
  children: TreeNode[];
}

export function fullName(person: Person) {
  return `${person.givenName} ${person.familyName}`.trim();
}

export function buildVerticalTree(people: Person[], relationships: Relationship[], rootId?: PersonId): TreeNode | null {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const peopleWithParents = new Set(
    relationships
      .filter((relationship) => relationship.kind === "parent_child")
      .map((relationship) => relationship.toPersonId)
  );
  const rootPerson = rootId ? peopleById.get(rootId) : undefined;
  const root = rootPerson ?? getBestRoot(people, relationships, peopleWithParents);
  if (!root) return null;

  const coveredIds = new Set<PersonId>();
  return walk(root, new Set<PersonId>(), coveredIds);

  function walk(person: Person, path: Set<PersonId>, covered: Set<PersonId>): TreeNode {
    covered.add(person.id);
    path.add(person.id);
    const partnerIds = getTreePartnerIds(person.id, relationships);
    partnerIds.forEach((id) => covered.add(id));

    const children = relationships
      .filter(
        (relationship) =>
          relationship.kind === "parent_child" &&
          (relationship.fromPersonId === person.id || partnerIds.includes(relationship.fromPersonId))
      )
      .map((relationship) => peopleById.get(relationship.toPersonId))
      .filter((child): child is Person => Boolean(child))
      .filter((child, index, all) => all.findIndex((candidate) => candidate.id === child.id) === index)
      .filter((child) => path.has(child.id) || !covered.has(child.id))
      .sort(comparePeopleByBirthDate)
      .map((child) =>
        path.has(child.id) ? { person: child, partners: [], children: [] } : walk(child, new Set(path), covered)
      );

    return {
      person,
      partners: partnerIds
        .map((id) => peopleById.get(id))
        .filter((partner): partner is Person => Boolean(partner))
        .sort((first, second) => Number(peopleWithParents.has(second.id)) - Number(peopleWithParents.has(first.id))),
      children
    };
  }
}

function getBestRoot(people: Person[], relationships: Relationship[], peopleWithParents: Set<PersonId>) {
  const parentlessPeople = people.filter(
    (person) => !peopleWithParents.has(person.id) && !isExternalPartnerRoot(person.id, relationships, peopleWithParents)
  );
  const parentlessFallback = people.filter((person) => !peopleWithParents.has(person.id));
  const candidates = parentlessPeople.length > 0 ? parentlessPeople : parentlessFallback.length > 0 ? parentlessFallback : people;

  return candidates
    .map((person) => ({
      person,
      score: countReachableFamily(person.id, relationships, new Set<PersonId>())
    }))
    .sort((first, second) => second.score - first.score)[0]?.person ?? null;
}

function isExternalPartnerRoot(
  personId: PersonId,
  relationships: Relationship[],
  peopleWithParents: Set<PersonId>
) {
  return getTreePartnerIds(personId, relationships).some((partnerId) => peopleWithParents.has(partnerId));
}

function getTreePartnerIds(personId: PersonId, relationships: Relationship[]) {
  const explicitPartnerIds = relationships
    .filter(
      (relationship) =>
        ["partner", "spouse", "former_spouse"].includes(relationship.kind) &&
        (relationship.fromPersonId === personId || relationship.toPersonId === personId)
    )
    .map((relationship) =>
      relationship.fromPersonId === personId ? relationship.toPersonId : relationship.fromPersonId
    );
  const childIds = relationships
    .filter((relationship) => relationship.kind === "parent_child" && relationship.fromPersonId === personId)
    .map((relationship) => relationship.toPersonId);
  const coparentIds = relationships
    .filter(
      (relationship) =>
        relationship.kind === "parent_child" &&
        childIds.includes(relationship.toPersonId) &&
        relationship.fromPersonId !== personId
    )
    .map((relationship) => relationship.fromPersonId);

  return [...explicitPartnerIds, ...coparentIds].filter((id, index, all) => all.indexOf(id) === index);
}

function countReachableFamily(personId: PersonId, relationships: Relationship[], visited: Set<PersonId>): number {
  if (visited.has(personId)) return 0;
  visited.add(personId);

  const partnerIds = getTreePartnerIds(personId, relationships);
  const childIds = relationships
    .filter(
      (relationship) =>
        relationship.kind === "parent_child" &&
        (relationship.fromPersonId === personId || partnerIds.includes(relationship.fromPersonId))
    )
    .map((relationship) => relationship.toPersonId)
    .filter((id, index, all) => all.indexOf(id) === index);

  return 1 + partnerIds.length + childIds.reduce((total, childId) => total + countReachableFamily(childId, relationships, visited), 0);
}

export function comparePeopleByBirthDate(first: Person, second: Person) {
  const firstTime = birthDateTime(first.birthDate);
  const secondTime = birthDateTime(second.birthDate);

  if (firstTime !== null && secondTime !== null && firstTime !== secondTime) {
    return firstTime - secondTime;
  }

  if (firstTime !== null && secondTime === null) return -1;
  if (firstTime === null && secondTime !== null) return 1;

  return fullName(first).localeCompare(fullName(second), "es");
}

function birthDateTime(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) {
    return createDateTime(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const yearFirst = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (yearFirst) {
    return createDateTime(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return createDateTime(Number(yearOnly[1]), 1, 1);
  }

  const date = new Date(trimmed);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function createDateTime(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date.getTime()
    : null;
}
