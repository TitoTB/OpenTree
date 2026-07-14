import type { Person, PersonId, Relationship } from "../domain/types";

export interface TreeNode {
  person: Person | null;
  partners: Person[];
  children: TreeNode[];
  generation?: number;
}

export function fullName(person: Person) {
  return `${person.givenName} ${person.familyName}`.trim();
}

export function buildVerticalTree(people: Person[], relationships: Relationship[], rootId?: PersonId): TreeNode | null {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const personGenerations = buildPersonGenerations(people, relationships);
  const peopleWithParents = new Set(
    relationships
      .filter((relationship) => relationship.kind === "parent_child")
      .map((relationship) => relationship.toPersonId)
  );
  const rootPerson = rootId ? peopleById.get(rootId) : undefined;
  const coveredIds = new Set<PersonId>();
  if (rootPerson) return walk(rootPerson, new Set<PersonId>(), coveredIds);

  const rootCandidates = getRootCandidates(people, relationships, peopleWithParents)
    .map((person) => ({
      person,
      score: countReachableFamily(person.id, relationships, new Set<PersonId>()),
      anchor: getDescendantGenerationAnchor(person.id, relationships, personGenerations)
    }))
    .sort(
      (first, second) =>
        first.anchor - second.anchor ||
        (personGenerations.get(first.person.id) ?? 0) - (personGenerations.get(second.person.id) ?? 0) ||
        second.score - first.score ||
        comparePeopleByBirthDate(first.person, second.person)
    )
    .map(({ person }) => person);
  const roots: TreeNode[] = [];

  rootCandidates.forEach((person) => {
    if (coveredIds.has(person.id)) return;
    const node = walk(person, new Set<PersonId>(), coveredIds);
    if (node.person || node.children.length > 0) {
      roots.push(node);
    }
  });

  if (roots.length === 0) return null;
  if (roots.length === 1) return roots[0];
  return { person: null, partners: [], children: roots, generation: 0 };

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
      .sort(comparePeopleByBirthDateDescending)
      .map((child) =>
        path.has(child.id) ? { person: child, partners: [], children: [] } : walk(child, new Set(path), covered)
      );

    return {
      person,
      generation: personGenerations.get(person.id) ?? 0,
      partners: partnerIds
        .map((id) => peopleById.get(id))
        .filter((partner): partner is Person => Boolean(partner))
        .sort(
          (first, second) =>
            Number(peopleWithParents.has(second.id)) - Number(peopleWithParents.has(first.id)) ||
            (personGenerations.get(first.id) ?? 0) - (personGenerations.get(second.id) ?? 0) ||
            comparePeopleByBirthDate(first, second)
        ),
      children
    };
  }
}

class PersonGroupUnion {
  private parents = new Map<PersonId, PersonId>();

  constructor(ids: PersonId[]) {
    ids.forEach((id) => this.parents.set(id, id));
  }

  find(id: PersonId): PersonId {
    const parent = this.parents.get(id) ?? id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parents.set(id, root);
    return root;
  }

  union(first: PersonId, second: PersonId) {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot !== secondRoot) {
      this.parents.set(secondRoot, firstRoot);
    }
  }
}

function buildPersonGenerations(people: Person[], relationships: Relationship[]) {
  const personIds = people.map((person) => person.id);
  const peopleIdsSet = new Set(personIds);
  const union = new PersonGroupUnion(personIds);

  relationships
    .filter((relationship) => ["partner", "spouse", "former_spouse"].includes(relationship.kind))
    .forEach((relationship) => {
      if (peopleIdsSet.has(relationship.fromPersonId) && peopleIdsSet.has(relationship.toPersonId)) {
        union.union(relationship.fromPersonId, relationship.toPersonId);
      }
    });

  const parentsByChild = new Map<PersonId, PersonId[]>();
  relationships
    .filter((relationship) => relationship.kind === "parent_child")
    .forEach((relationship) => {
      const parents = parentsByChild.get(relationship.toPersonId) ?? [];
      parents.push(relationship.fromPersonId);
      parentsByChild.set(relationship.toPersonId, parents);
    });
  parentsByChild.forEach((parents) => {
    parents.forEach((parentId) => {
      parents.forEach((otherParentId) => {
        if (parentId !== otherParentId && peopleIdsSet.has(parentId) && peopleIdsSet.has(otherParentId)) {
          union.union(parentId, otherParentId);
        }
      });
    });
  });

  const groupIds = new Set(personIds.map((id) => union.find(id)));
  const groupParents = new Map<PersonId, Set<PersonId>>();
  const groupChildren = new Map<PersonId, Set<PersonId>>();

  relationships
    .filter((relationship) => relationship.kind === "parent_child")
    .forEach((relationship) => {
      if (!peopleIdsSet.has(relationship.fromPersonId) || !peopleIdsSet.has(relationship.toPersonId)) return;
      const parentGroup = union.find(relationship.fromPersonId);
      const childGroup = union.find(relationship.toPersonId);
      if (parentGroup === childGroup) return;
      const children = groupChildren.get(parentGroup) ?? new Set<PersonId>();
      children.add(childGroup);
      groupChildren.set(parentGroup, children);
      const parents = groupParents.get(childGroup) ?? new Set<PersonId>();
      parents.add(parentGroup);
      groupParents.set(childGroup, parents);
    });

  const groupDepth = new Map<PersonId, number>();
  const visitGroup = (groupId: PersonId, visiting = new Set<PersonId>()): number => {
    if (groupDepth.has(groupId)) return groupDepth.get(groupId) ?? 0;
    if (visiting.has(groupId)) return 0;
    visiting.add(groupId);
    const parents = Array.from(groupParents.get(groupId) ?? []);
    const depth = parents.length > 0 ? Math.max(...parents.map((parentId) => visitGroup(parentId, new Set(visiting)) + 1)) : 0;
    groupDepth.set(groupId, depth);
    return depth;
  };

  groupIds.forEach((groupId) => visitGroup(groupId));
  alignParentGenerationsWithAnchoredChildren(groupDepth, groupChildren);

  const personGenerations = new Map<PersonId, number>();
  people.forEach((person) => {
    personGenerations.set(person.id, groupDepth.get(union.find(person.id)) ?? 0);
  });

  return normalizeGenerationStarts(personGenerations);
}

function alignParentGenerationsWithAnchoredChildren(
  groupDepth: Map<PersonId, number>,
  groupChildren: Map<PersonId, Set<PersonId>>
) {
  let changed = true;
  let guard = 0;
  while (changed && guard < 100) {
    changed = false;
    guard += 1;
    groupChildren.forEach((childIds, parentId) => {
      const parentDepth = groupDepth.get(parentId) ?? 0;
      const anchoredParentDepth = Array.from(childIds).reduce((highestAllowedDepth, childId) => {
        const childDepth = groupDepth.get(childId);
        if (typeof childDepth !== "number" || childDepth <= 0) return highestAllowedDepth;
        return Math.max(highestAllowedDepth, childDepth - 1);
      }, parentDepth);

      if (anchoredParentDepth > parentDepth) {
        groupDepth.set(parentId, anchoredParentDepth);
        changed = true;
      }
    });
  }
}

function normalizeGenerationStarts(personGenerations: Map<PersonId, number>) {
  const minGeneration = Math.min(...Array.from(personGenerations.values()), 0);
  if (minGeneration === 0) return personGenerations;
  const normalized = new Map<PersonId, number>();
  personGenerations.forEach((generation, personId) => {
    normalized.set(personId, generation - minGeneration);
  });
  return normalized;
}

function getDescendantGenerationAnchor(
  personId: PersonId,
  relationships: Relationship[],
  personGenerations: Map<PersonId, number>
) {
  const childIds = relationships
    .filter((relationship) => relationship.kind === "parent_child" && relationship.fromPersonId === personId)
    .map((relationship) => relationship.toPersonId);
  const childGenerations = childIds
    .map((childId) => personGenerations.get(childId))
    .filter((generation): generation is number => typeof generation === "number");

  if (childGenerations.length > 0) {
    return childGenerations.reduce((total, generation) => total + generation, 0) / childGenerations.length;
  }

  return personGenerations.get(personId) ?? 0;
}

function getRootCandidates(people: Person[], relationships: Relationship[], peopleWithParents: Set<PersonId>) {
  const parentlessPeople = people.filter(
    (person) => !peopleWithParents.has(person.id) && !isExternalPartnerRoot(person.id, relationships, peopleWithParents)
  );
  const parentlessFallback = people.filter((person) => !peopleWithParents.has(person.id));
  return parentlessPeople.length > 0 ? parentlessPeople : parentlessFallback.length > 0 ? parentlessFallback : people;
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

function comparePeopleByBirthDateDescending(first: Person, second: Person) {
  return -comparePeopleByBirthDate(first, second);
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
