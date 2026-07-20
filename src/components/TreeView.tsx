import { useMemo } from "react";
import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import type { ClinicalCondition, ClinicalConditionCategory, DisplaySettings, Person, Relationship } from "../domain/types";
import { buildPersonGenerations, comparePeopleByBirthDate } from "../tree/layout";
import type { TreeNode } from "../tree/layout";
import { PersonCard } from "./PersonCard";
import type { LifeLabels } from "./PersonCard";

export type AddRelativeKind = "parent" | "partner" | "child";

type TreeConnector = {
  d: string;
};

type GenerationGuide = {
  y: number;
  label: string;
  startYear?: number;
};

type BranchSide = "left" | "right";
const TREE_GENERATION_ROW_HEIGHT = 170;
const TREE_CARD_WIDTH = 220;
const TREE_CARD_HEIGHT = 78;
const TREE_CARD_GAP = 24;
const TREE_PARTNER_CONNECTOR_WIDTH = 44;
const TREE_PARTNER_GAP = 8;
const TREE_TOP_PADDING = 18;
const TREE_LEFT_PADDING = 28;
const TREE_RIGHT_PADDING = 28;
const TREE_BOTTOM_PADDING = 44;
const TREE_BRANCH_GAP = 24;

type TreeLayoutPerson = {
  person: Person;
  x: number;
  y: number;
  primaryAnchor?: boolean;
};

type TreeLayoutRelationship = {
  x: number;
  y: number;
  hidden?: boolean;
  startDate?: string;
};

type TreeLayout = {
  width: number;
  height: number;
  people: TreeLayoutPerson[];
  relationships: TreeLayoutRelationship[];
  connectors: TreeConnector[];
  generationGuides: GenerationGuide[];
};

type LayoutBranch = {
  width: number;
  height: number;
  anchorX: number;
  people: TreeLayoutPerson[];
  relationships: TreeLayoutRelationship[];
  connectors: TreeConnector[];
};

interface TreeViewProps {
  node: TreeNode | TreeNode[] | null;
  fallbackPeople: Person[];
  relationships: Relationship[];
  selectedId: string;
  onSelect: (person: Person) => void;
  onAddRelative: (person: Person, kind: AddRelativeKind) => void;
  addLabels: Record<AddRelativeKind, string>;
  lifeLabels: LifeLabels;
  displaySettings: DisplaySettings;
  clinicalConditions: ClinicalCondition[];
  clinicalCategories?: ClinicalConditionCategory[];
  parentCounts: Record<string, number>;
  viewportScale: number;
  visiblePersonIds?: Set<string>;
  visiblePartnerRelationshipKeys?: Set<string>;
  flagBackgrounds?: Record<string, string>;
}

export function TreeView({
  node,
  fallbackPeople,
  relationships,
  selectedId,
  onSelect,
  onAddRelative,
  addLabels,
  lifeLabels,
  displaySettings,
  clinicalConditions,
  clinicalCategories = [],
  parentCounts,
  viewportScale,
  visiblePersonIds,
  visiblePartnerRelationshipKeys,
  flagBackgrounds
}: TreeViewProps) {
  const nodes = useMemo(() => normalizeTreeNodes(node, fallbackPeople, relationships), [node, fallbackPeople, relationships]);
  const layout = useMemo(
    () => buildTreeLayout(nodes, fallbackPeople, relationships, visiblePersonIds, visiblePartnerRelationshipKeys),
    [nodes, fallbackPeople, relationships, visiblePersonIds, visiblePartnerRelationshipKeys]
  );

  if (nodes.length === 0) return null;

  return (
    <div
      className="tree-stage tree-stage-positioned"
      style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
      aria-label="Vertical family tree"
    >
      {displaySettings.showGenerationLines ? (
        <svg
          className="tree-generation-guides-svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          {layout.generationGuides.map((guide) => (
            <g key={`${guide.label}-${guide.y}`}>
              <path d={`M 0 ${guide.y} H ${layout.width}`} />
            </g>
          ))}
        </svg>
      ) : null}
      {displaySettings.showGenerationLines ? (
        <div className="tree-generation-labels" aria-hidden="true">
          {layout.generationGuides.map((guide) => (
            <span key={`${guide.label}-${guide.y}`} style={{ top: `${guide.y}px` }}>
              <strong>{guide.label}</strong>
              {guide.startYear ? <small>{guide.startYear}</small> : null}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        className="tree-connectors-svg"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
      >
        {layout.connectors.map((connector, index) => (
          <path key={`${connector.d}-${index}`} d={connector.d} />
        ))}
      </svg>
      {layout.relationships.map((relationship, index) => (
        <span
          className="tree-relationship-slot"
          style={{ left: `${relationship.x}px`, top: `${relationship.y}px` }}
          key={`${relationship.x}-${relationship.y}-${index}`}
        >
          <PartnerConnector hidden={relationship.hidden} startDate={relationship.startDate} />
        </span>
      ))}
      {layout.people.map((entry) => (
        <TreePerson
          key={entry.person.id}
          person={entry.person}
          primaryAnchor={entry.primaryAnchor}
          selected={selectedId === entry.person.id}
          timelineVisible={isTimelineVisible(entry.person.id, visiblePersonIds)}
          compact
          style={{ left: `${entry.x}px`, top: `${entry.y}px` }}
          onSelect={onSelect}
          onAddRelative={onAddRelative}
          addLabels={addLabels}
          lifeLabels={lifeLabels}
          displaySettings={displaySettings}
          clinicalConditions={clinicalConditions}
          clinicalCategories={clinicalCategories}
          canAddParent={(parentCounts[entry.person.id] ?? 0) < 2}
          flagPortraitUrl={flagBackgrounds?.[entry.person.id]}
        />
      ))}
    </div>
  );
}

function buildTreeLayout(
  nodes: TreeNode[],
  people: Person[],
  relationships: Relationship[],
  visiblePersonIds?: Set<string>,
  visiblePartnerRelationshipKeys?: Set<string>
): TreeLayout {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const generations = buildPersonGenerations(people, relationships);
  const sortedRoots = sortRootNodesByDescendant(nodes, relationships, people);
  const rootLayouts = sortedRoots.map((root, index) =>
    buildLayoutBranch(root, {
      peopleById,
      relationships,
      generations,
      visiblePersonIds,
      visiblePartnerRelationshipKeys,
      externalSide: getBranchSide(index, sortedRoots.length)
    })
  );
  const widthWithoutPadding =
    rootLayouts.reduce((total, branch) => total + branch.width, 0) +
    TREE_BRANCH_GAP * Math.max(0, rootLayouts.length - 1);
  const contentWidth = Math.max(TREE_CARD_WIDTH, widthWithoutPadding);
  const peopleEntries: TreeLayoutPerson[] = [];
  const relationshipEntries: TreeLayoutRelationship[] = [];
  const connectors: TreeConnector[] = [];
  let cursor = TREE_LEFT_PADDING;

  rootLayouts.forEach((branch) => {
    peopleEntries.push(...offsetLayoutPeople(branch.people, cursor, 0));
    relationshipEntries.push(...offsetLayoutRelationships(branch.relationships, cursor, 0));
    connectors.push(...offsetLayoutConnectors(branch.connectors, cursor, 0));
    cursor += branch.width + TREE_BRANCH_GAP;
  });

  const dedupedPeople = dedupeLayoutPeople(peopleEntries);
  const maxY = Math.max(
    TREE_CARD_HEIGHT,
    ...dedupedPeople.map((entry) => entry.y + TREE_CARD_HEIGHT),
    ...connectors.flatMap((connector) => extractPathNumbers(connector.d).filter((_, index) => index % 2 === 1))
  );
  const maxX = Math.max(
    contentWidth + TREE_LEFT_PADDING + TREE_RIGHT_PADDING,
    ...dedupedPeople.map((entry) => entry.x + TREE_CARD_WIDTH + TREE_RIGHT_PADDING)
  );
  const generationGuides = buildGenerationGuides(dedupedPeople);

  return {
    width: Math.ceil(maxX),
    height: Math.ceil(maxY + TREE_BOTTOM_PADDING),
    people: dedupedPeople,
    relationships: relationshipEntries,
    connectors,
    generationGuides
  };
}

function buildLayoutBranch(
  node: TreeNode,
  context: {
    peopleById: Map<string, Person>;
    relationships: Relationship[];
    generations: Map<string, number>;
    visiblePersonIds?: Set<string>;
    visiblePartnerRelationshipKeys?: Set<string>;
    externalSide?: BranchSide;
  }
): LayoutBranch {
  if (!node.person) {
    const sortedChildren = sortRootNodesByDescendant(node.children, context.relationships, Array.from(context.peopleById.values()));
    const childLayouts = sortedChildren.map((child, index) =>
      buildLayoutBranch(child, { ...context, externalSide: getBranchSide(index, sortedChildren.length) })
    );
    const width = Math.max(
      TREE_CARD_WIDTH,
      childLayouts.reduce((total, child) => total + child.width, 0) +
        TREE_BRANCH_GAP * Math.max(0, childLayouts.length - 1)
    );
    const peopleEntries: TreeLayoutPerson[] = [];
    const relationshipEntries: TreeLayoutRelationship[] = [];
    const connectors: TreeConnector[] = [];
    let cursor = 0;

    childLayouts.forEach((child) => {
      peopleEntries.push(...offsetLayoutPeople(child.people, cursor, 0));
      relationshipEntries.push(...offsetLayoutRelationships(child.relationships, cursor, 0));
      connectors.push(...offsetLayoutConnectors(child.connectors, cursor, 0));
      cursor += child.width + TREE_BRANCH_GAP;
    });

    return {
      width,
      height: Math.max(0, ...childLayouts.map((child) => child.height)),
      anchorX: width / 2,
      people: peopleEntries,
      relationships: relationshipEntries,
      connectors
    };
  }

  const person = node.person;
  const visiblePartners = node.partners.filter((partner) => isTimelineVisible(partner.id, context.visiblePersonIds));
  const sortedChildren = sortSiblingTreeNodes(node.children);
  const childLayouts = sortedChildren.map((child, index) =>
    buildLayoutBranch(child, { ...context, externalSide: getBranchSide(index, sortedChildren.length) })
  );
  const partnersOnLeft = context.externalSide === "left";
  const couple = buildCoupleLayout(person, visiblePartners, partnersOnLeft, context);
  const childrenWidth =
    childLayouts.reduce((total, child) => total + child.width, 0) +
    TREE_BRANCH_GAP * Math.max(0, childLayouts.length - 1);
  const hasChildren = childLayouts.length > 0;
  const childCenter = hasChildren ? childrenWidth / 2 : couple.anchorX;
  const coupleOffset = hasChildren ? childCenter - couple.anchorX : 0;
  const minX = Math.min(0, coupleOffset);
  const maxX = Math.max(hasChildren ? childrenWidth : 0, coupleOffset + couple.width);
  const normalizeX = -minX;
  const width = Math.max(TREE_CARD_WIDTH, maxX - minX);
  const generation = context.generations.get(person.id) ?? node.generation ?? 0;
  const y = TREE_TOP_PADDING + generation * TREE_GENERATION_ROW_HEIGHT;
  const peopleEntries = offsetLayoutPeople(couple.people, coupleOffset + normalizeX, y);
  const relationshipEntries = offsetLayoutRelationships(couple.relationships, coupleOffset + normalizeX, y);
  const connectors: TreeConnector[] = [];
  const childPeople: TreeLayoutPerson[] = [];
  const childRelationships: TreeLayoutRelationship[] = [];
  const childConnectors: TreeConnector[] = [];
  let childCursor = normalizeX;

  childLayouts.forEach((child) => {
    childPeople.push(...offsetLayoutPeople(child.people, childCursor, 0));
    childRelationships.push(...offsetLayoutRelationships(child.relationships, childCursor, 0));
    childConnectors.push(...offsetLayoutConnectors(child.connectors, childCursor, 0));
    childCursor += child.width + TREE_BRANCH_GAP;
  });

  if (childLayouts.length > 0) {
    const relationshipX = coupleOffset + normalizeX + couple.anchorX;
    const relationshipY = y + (TREE_CARD_HEIGHT - 30) / 2 + 30;
    const childPoints = childLayouts.map((child, index) => {
      const xOffset =
        normalizeX +
        childLayouts.slice(0, index).reduce((total, previous) => total + previous.width + TREE_BRANCH_GAP, 0);
      const firstVisiblePerson = child.people.find((entry) => isTimelineVisible(entry.person.id, context.visiblePersonIds));
      return {
        x: xOffset + child.anchorX,
        y: firstVisiblePerson?.y ?? TREE_TOP_PADDING + ((child.people[0] ? context.generations.get(child.people[0].person.id) : generation + 1) ?? generation + 1) * TREE_GENERATION_ROW_HEIGHT
      };
    });
    const junctionY = Math.min(...childPoints.map((point) => point.y)) - 34;
    const minChildX = Math.min(...childPoints.map((point) => point.x), relationshipX);
    const maxChildX = Math.max(...childPoints.map((point) => point.x), relationshipX);

    connectors.push({
      d: `M ${formatCoord(relationshipX)} ${formatCoord(relationshipY)} V ${formatCoord(junctionY)}`
    });
    if (maxChildX - minChildX > 0.5) {
      connectors.push({ d: `M ${formatCoord(minChildX)} ${formatCoord(junctionY)} H ${formatCoord(maxChildX)}` });
    }
    childPoints.forEach((point) => {
      connectors.push({
        d: `M ${formatCoord(point.x)} ${formatCoord(junctionY)} V ${formatCoord(point.y)}`
      });
    });
  }

  return {
    width,
    height: Math.max(y + TREE_CARD_HEIGHT, ...childLayouts.map((child) => child.height)),
    anchorX: coupleOffset + normalizeX + couple.anchorX,
    people: [...peopleEntries, ...childPeople],
    relationships: [...relationshipEntries, ...childRelationships],
    connectors: [...connectors, ...childConnectors]
  };
}

function buildCoupleLayout(
  person: Person,
  partners: Person[],
  partnersOnLeft: boolean,
  context: {
    relationships: Relationship[];
    visiblePersonIds?: Set<string>;
    visiblePartnerRelationshipKeys?: Set<string>;
  }
) {
  const peopleEntries: TreeLayoutPerson[] = [];
  const relationshipEntries: TreeLayoutRelationship[] = [];
  const partnerGap = TREE_PARTNER_GAP * 2 + TREE_PARTNER_CONNECTOR_WIDTH;
  const width = TREE_CARD_WIDTH + partners.length * (partnerGap + TREE_CARD_WIDTH);
  let personX = partnersOnLeft ? width - TREE_CARD_WIDTH : 0;

  peopleEntries.push({ person, x: personX, y: 0, primaryAnchor: true });

  partners.forEach((partner, index) => {
    const partnerX = partnersOnLeft
      ? personX - (index + 1) * (TREE_CARD_WIDTH + partnerGap)
      : personX + TREE_CARD_WIDTH + partnerGap + index * (TREE_CARD_WIDTH + partnerGap);
    const connectorX = partnersOnLeft
      ? partnerX + TREE_CARD_WIDTH + TREE_PARTNER_GAP
      : personX + TREE_CARD_WIDTH + TREE_PARTNER_GAP + index * (TREE_CARD_WIDTH + partnerGap);
    const startDate = getPartnerRelationshipStartDate(person.id, partner.id, context.relationships);

    peopleEntries.push({ person: partner, x: partnerX, y: 0 });
    relationshipEntries.push({
      x: connectorX,
      y: (TREE_CARD_HEIGHT - 30) / 2,
      hidden:
        !isTimelineVisible(person.id, context.visiblePersonIds) ||
        !isTimelineVisible(partner.id, context.visiblePersonIds) ||
        !isTimelinePartnerVisible(person.id, partner.id, context.visiblePartnerRelationshipKeys),
      startDate
    });
  });

  const visibleRelationships = relationshipEntries.filter((relationship) => !relationship.hidden);
  const anchorX =
    visibleRelationships.length > 0
      ? visibleRelationships.reduce((total, relationship) => total + relationship.x + TREE_PARTNER_CONNECTOR_WIDTH / 2, 0) /
        visibleRelationships.length
      : personX + TREE_CARD_WIDTH / 2;

  return { width, anchorX, people: peopleEntries, relationships: relationshipEntries };
}

function offsetLayoutPeople(people: TreeLayoutPerson[], x: number, y: number) {
  return people.map((entry) => ({ ...entry, x: entry.x + x, y: entry.y + y }));
}

function offsetLayoutRelationships(relationships: TreeLayoutRelationship[], x: number, y: number) {
  return relationships.map((entry) => ({ ...entry, x: entry.x + x, y: entry.y + y }));
}

function offsetLayoutConnectors(connectors: TreeConnector[], x: number, y: number) {
  if (x === 0 && y === 0) return connectors;
  return connectors.map((connector) => ({
    d: connector.d.replace(/([MLHV])\s*([-\d.]+)(?:\s+([-\d.]+))?/g, (_match, command, first, second) => {
      if (command === "H") return `H ${formatCoord(Number(first) + x)}`;
      if (command === "V") return `V ${formatCoord(Number(first) + y)}`;
      return `${command} ${formatCoord(Number(first) + x)} ${formatCoord(Number(second) + y)}`;
    })
  }));
}

function dedupeLayoutPeople(people: TreeLayoutPerson[]) {
  const seen = new Set<string>();
  return people.filter((entry) => {
    if (seen.has(entry.person.id)) return false;
    seen.add(entry.person.id);
    return true;
  });
}

function buildGenerationGuides(people: TreeLayoutPerson[]) {
  const rows = new Map<number, number[]>();
  people.forEach((entry) => {
    if (!rows.has(entry.y)) rows.set(entry.y, []);
    const birthYear = extractBirthYear(entry.person.birthDate);
    if (birthYear !== null) rows.get(entry.y)?.push(birthYear);
  });

  return Array.from(rows.entries())
    .sort((first, second) => first[0] - second[0])
    .map(([y, years], index) => ({
      y: y + TREE_CARD_HEIGHT / 2,
      label: `${index + 1} GEN`,
      startYear: years.length > 0 ? Math.min(...years) : undefined
    }));
}

function extractPathNumbers(path: string) {
  return Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) => Number(match[0]));
}

function TreeBranch({
  node,
  selectedId,
  onSelect,
  onAddRelative,
  addLabels,
  lifeLabels,
  displaySettings,
  clinicalConditions,
  clinicalCategories,
  parentCounts,
  fallbackPeople,
  relationships,
  branchKey,
  externalSide,
  rootGenerationOffset,
  visiblePersonIds,
  visiblePartnerRelationshipKeys,
  flagBackgrounds
}: Omit<TreeViewProps, "node" | "viewportScale"> & {
  node: TreeNode;
  branchKey: string;
  externalSide?: BranchSide;
  rootGenerationOffset?: number;
}) {
  if (!node.person) {
    if (node.children.length === 0) return null;
    const sortedChildren = sortRootNodesByDescendant(node.children, relationships, fallbackPeople);

    return (
      <div className="tree-branch virtual-root has-children" data-tree-branch-id={branchKey}>
        <div className="children-row">
          {sortedChildren.map((child, index) => (
            <TreeBranch
              key={child.person?.id ?? `virtual-${index}`}
              branchKey={`${branchKey}-${child.person?.id ?? `virtual-${index}`}`}
              externalSide={getBranchSide(index, sortedChildren.length)}
              node={child}
              fallbackPeople={fallbackPeople}
              relationships={relationships}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddRelative={onAddRelative}
              addLabels={addLabels}
              lifeLabels={lifeLabels}
              displaySettings={displaySettings}
              clinicalConditions={clinicalConditions}
              clinicalCategories={clinicalCategories}
              parentCounts={parentCounts}
              visiblePersonIds={visiblePersonIds}
              visiblePartnerRelationshipKeys={visiblePartnerRelationshipKeys}
              flagBackgrounds={flagBackgrounds}
            />
          ))}
        </div>
      </div>
    );
  }

  const person = node.person;
  const hasChildren = node.children.length > 0;
  const sortedChildren = sortSiblingTreeNodes(node.children);
  const partnersOnLeft = externalSide === "left";
  const isPersonVisible = isTimelineVisible(person.id, visiblePersonIds);
  const partnerNodes = node.partners.map((partner) => {
    const relationshipStartDate = getPartnerRelationshipStartDate(person.id, partner.id, relationships);

    return (
      <div className={`couple-partner ${partnersOnLeft ? "partner-left" : ""}`} key={partner.id}>
        <PartnerConnector
          hidden={
            !isPersonVisible ||
            !isTimelineVisible(partner.id, visiblePersonIds) ||
            !isTimelinePartnerVisible(person.id, partner.id, visiblePartnerRelationshipKeys)
          }
          startDate={relationshipStartDate}
        />
        <TreePerson
          person={partner}
          selected={selectedId === partner.id}
          timelineVisible={isTimelineVisible(partner.id, visiblePersonIds)}
          compact
          onSelect={onSelect}
          onAddRelative={onAddRelative}
          addLabels={addLabels}
          lifeLabels={lifeLabels}
          displaySettings={displaySettings}
          clinicalConditions={clinicalConditions}
          clinicalCategories={clinicalCategories}
          canAddParent={(parentCounts[partner.id] ?? 0) < 2}
          flagPortraitUrl={flagBackgrounds?.[partner.id]}
        />
      </div>
    );
  });

  return (
    <div
      className={`tree-branch ${hasChildren ? "has-children" : ""}`}
      data-tree-branch-id={branchKey}
      style={rootGenerationOffset ? ({ marginTop: `${rootGenerationOffset * TREE_GENERATION_ROW_HEIGHT}px` } as CSSProperties) : undefined}
    >
      <div className={`couple-row ${partnersOnLeft ? "partners-left" : ""}`}>
        {partnersOnLeft ? partnerNodes : null}
        <TreePerson
          person={person}
          primaryAnchor
          selected={selectedId === person.id}
          timelineVisible={isPersonVisible}
          onSelect={onSelect}
          onAddRelative={onAddRelative}
          addLabels={addLabels}
          lifeLabels={lifeLabels}
          displaySettings={displaySettings}
          clinicalConditions={clinicalConditions}
          clinicalCategories={clinicalCategories}
          canAddParent={(parentCounts[person.id] ?? 0) < 2}
          flagPortraitUrl={flagBackgrounds?.[person.id]}
        />
        {!partnersOnLeft ? partnerNodes : null}
      </div>
      {sortedChildren.length > 0 ? (
        <div className="children-row">
          {sortedChildren.map((child, index) => (
            <TreeBranch
              key={child.person?.id ?? `child-${index}`}
              branchKey={`${branchKey}-${child.person?.id ?? `child-${index}`}`}
              externalSide={getBranchSide(index, sortedChildren.length)}
              node={child}
              fallbackPeople={fallbackPeople}
              relationships={relationships}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddRelative={onAddRelative}
              addLabels={addLabels}
              lifeLabels={lifeLabels}
              displaySettings={displaySettings}
              clinicalConditions={clinicalConditions}
              clinicalCategories={clinicalCategories}
              parentCounts={parentCounts}
              visiblePersonIds={visiblePersonIds}
              visiblePartnerRelationshipKeys={visiblePartnerRelationshipKeys}
              flagBackgrounds={flagBackgrounds}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeTreeNodes(node: TreeViewProps["node"], fallbackPeople: Person[], relationships: Relationship[]) {
  const nodes = sortRootNodesByDescendant(flattenTreeNodes(node), relationships, fallbackPeople);

  if (nodes.length > 0) return nodes;

  return fallbackPeople[0] ? [{ person: fallbackPeople[0], partners: [], children: [] }] : [];
}

function sortSiblingTreeNodes(nodes: TreeNode[]) {
  return [...nodes].sort((first, second) => compareNullableTreePeopleYoungerFirst(first.person, second.person));
}

function sortRootNodesByDescendant(nodes: TreeNode[], relationships: Relationship[], people: Person[]) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const peopleRank = buildVisualPeopleRank(people, relationships);

  return [...nodes].sort((first, second) => {
    const firstAnchor = getDescendantAnchorRank(first, relationships, peopleById, peopleRank);
    const secondAnchor = getDescendantAnchorRank(second, relationships, peopleById, peopleRank);

    if (firstAnchor !== secondAnchor) return firstAnchor - secondAnchor;
    const generationOrder = (first.generation ?? 0) - (second.generation ?? 0);
    if (generationOrder !== 0) return generationOrder;
    const coupleOrder = compareRootNodesByLinkedCouple(first, second, relationships, peopleById);
    if (coupleOrder !== 0) return coupleOrder;
    return compareNullableTreePeopleYoungerFirst(first.person, second.person);
  });
}

function buildVisualPeopleRank(people: Person[], relationships: Relationship[]) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const childIds = new Set(
    relationships
      .filter((relationship) => relationship.kind === "parent_child")
      .map((relationship) => relationship.toPersonId)
  );
  const roots = people
    .filter((person) => !childIds.has(person.id))
    .sort(comparePeopleYoungerFirst);
  const visited = new Set<string>();
  const ordered: Person[] = [];

  const visit = (person: Person) => {
    if (visited.has(person.id)) return;
    visited.add(person.id);
    ordered.push(person);

    getPartnerIds(person.id, relationships)
      .map((id) => peopleById.get(id))
      .filter((partner): partner is Person => Boolean(partner))
      .sort(comparePeopleYoungerFirst)
      .forEach((partner) => {
        if (!visited.has(partner.id)) {
          visited.add(partner.id);
          ordered.push(partner);
        }
      });

    relationships
      .filter((relationship) => relationship.kind === "parent_child" && relationship.fromPersonId === person.id)
      .map((relationship) => peopleById.get(relationship.toPersonId))
      .filter((child): child is Person => Boolean(child))
      .sort(comparePeopleYoungerFirst)
      .forEach(visit);
  };

  roots.forEach(visit);
  people.filter((person) => !visited.has(person.id)).sort(comparePeopleYoungerFirst).forEach(visit);

  return new Map(ordered.map((person, index) => [person.id, index]));
}

function flattenTreeNodes(node: TreeViewProps["node"]): TreeNode[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap((child) => flattenTreeNodes(child));
  if (node.person) return [node];
  return node.children.flatMap((child) => flattenTreeNodes(child));
}

function compareNullableTreePeopleYoungerFirst(first: Person | null, second: Person | null) {
  if (first && second) return comparePeopleYoungerFirst(first, second);
  if (first) return -1;
  if (second) return 1;
  return 0;
}

function comparePeopleYoungerFirst(first: Person, second: Person) {
  return -comparePeopleByBirthDate(first, second);
}

function compareRootNodesByLinkedCouple(
  first: TreeNode,
  second: TreeNode,
  relationships: Relationship[],
  peopleById: Map<string, Person>
) {
  const firstDescendants = getTreeNodePersonIds(first);
  const secondDescendants = getTreeNodePersonIds(second);
  const partnerRelationship = relationships.find((relationship) => {
    if (!["partner", "spouse", "former_spouse"].includes(relationship.kind)) return false;
    return (
      (firstDescendants.has(relationship.fromPersonId) && secondDescendants.has(relationship.toPersonId)) ||
      (firstDescendants.has(relationship.toPersonId) && secondDescendants.has(relationship.fromPersonId))
    );
  });

  if (!partnerRelationship) return 0;

  const firstPartnerId = firstDescendants.has(partnerRelationship.fromPersonId)
    ? partnerRelationship.fromPersonId
    : partnerRelationship.toPersonId;
  const secondPartnerId = secondDescendants.has(partnerRelationship.fromPersonId)
    ? partnerRelationship.fromPersonId
    : partnerRelationship.toPersonId;
  const firstPartner = peopleById.get(firstPartnerId);
  const secondPartner = peopleById.get(secondPartnerId);

  if (!firstPartner || !secondPartner) return 0;
  return compareCoupleSide(firstPartner, secondPartner);
}

function compareCoupleSide(first: Person, second: Person) {
  const firstRank = getCoupleSideRank(first);
  const secondRank = getCoupleSideRank(second);

  if (firstRank !== secondRank) return firstRank - secondRank;
  return comparePeopleYoungerFirst(first, second);
}

function getCoupleSideRank(person: Person) {
  if (person.gender === "female") return 0;
  if (person.gender === "male") return 1;
  return 2;
}

function getTreeNodePersonIds(node: TreeNode) {
  return new Set(
    flattenTreeNodes(node)
      .flatMap((child) => [child.person?.id, ...child.partners.map((partner) => partner.id)])
      .filter((id): id is string => Boolean(id))
  );
}

function getPartnerIds(personId: string, relationships: Relationship[]) {
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

function getDescendantAnchorRank(
  node: TreeNode,
  relationships: Relationship[],
  peopleById: Map<string, Person>,
  peopleRank: Map<string, number>
) {
  const parentIds = new Set(
    [node.person?.id, ...node.partners.map((partner) => partner.id)].filter((id): id is string => Boolean(id))
  );
  const directChildRanks = relationships
    .filter((relationship) => relationship.kind === "parent_child" && parentIds.has(relationship.fromPersonId))
    .map((relationship) => peopleRank.get(relationship.toPersonId))
    .filter((rank): rank is number => typeof rank === "number");

  if (directChildRanks.length > 0) {
    return directChildRanks.reduce((total, rank) => total + rank, 0) / directChildRanks.length;
  }

  const descendantRanks = flattenTreeNodes(node)
    .map((child) => (child.person ? peopleRank.get(child.person.id) : undefined))
    .filter((rank): rank is number => typeof rank === "number");

  if (descendantRanks.length > 0) {
    return descendantRanks.reduce((total, rank) => total + rank, 0) / descendantRanks.length;
  }

  const fallbackPerson = node.person ? peopleById.get(node.person.id) : undefined;
  return fallbackPerson ? (peopleRank.get(fallbackPerson.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
}

function getBranchSide(index: number, total: number): BranchSide | undefined {
  if (total <= 1) return undefined;

  const midpoint = (total - 1) / 2;
  if (index < midpoint) return "left";
  if (index > midpoint) return "right";
  return undefined;
}

function getCenteredRect(rects: DOMRect[]) {
  const minX = Math.min(...rects.map((rect) => rect.left));
  const maxX = Math.max(...rects.map((rect) => rect.right));
  const minY = Math.min(...rects.map((rect) => rect.top));
  const maxY = Math.max(...rects.map((rect) => rect.bottom));

  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
    right: maxX,
    bottom: maxY
  };
}

function getCoupleRowPeople(coupleRow: HTMLElement) {
  return Array.from(
    coupleRow.querySelectorAll<HTMLElement>(":scope > .tree-person, :scope > .couple-partner > .tree-person")
  );
}

function formatCoord(value: number) {
  return Number(value.toFixed(2));
}

function getCssPixelValue(element: HTMLElement, propertyName: string) {
  const rawValue = element.style.getPropertyValue(propertyName);
  const parsedValue = Number.parseFloat(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function isTimelineVisible(personId: string, visiblePersonIds?: Set<string>) {
  return !visiblePersonIds || visiblePersonIds.has(personId);
}

function isTimelinePartnerVisible(firstId: string, secondId: string, visiblePartnerRelationshipKeys?: Set<string>) {
  return !visiblePartnerRelationshipKeys || visiblePartnerRelationshipKeys.has(getRelationshipKey(firstId, secondId));
}

function getRelationshipKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join("::");
}

function getParentChildKey(parentId: string, childId: string) {
  return `${parentId}::${childId}`;
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function extractBirthYear(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const yearFirst = trimmed.match(/^(\d{4})/);
  if (yearFirst) return Number(yearFirst[1]);

  const dayFirst = trimmed.match(/\b(\d{4})\b/);
  if (dayFirst) return Number(dayFirst[1]);

  return null;
}

function getPartnerRelationshipStartDate(firstId: string, secondId: string, relationships: Relationship[]) {
  return relationships.find(
    (relationship) =>
      ["partner", "spouse", "former_spouse"].includes(relationship.kind) &&
      ((relationship.fromPersonId === firstId && relationship.toPersonId === secondId) ||
        (relationship.fromPersonId === secondId && relationship.toPersonId === firstId))
  )?.startDate;
}

function formatRelationshipStartDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const yearFirst = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yearFirst) return `${yearFirst[3].padStart(2, "0")}/${yearFirst[2].padStart(2, "0")}/${yearFirst[1]}`;

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) return `${dayFirst[1].padStart(2, "0")}/${dayFirst[2].padStart(2, "0")}/${dayFirst[3]}`;

  return trimmed;
}

function PartnerConnector({ hidden, startDate }: { hidden?: boolean; startDate?: string }) {
  const formattedStartDate = formatRelationshipStartDate(startDate);

  return (
    <span
      className={`partner-connector ${hidden ? "timeline-hidden" : ""}`}
      aria-label={formattedStartDate ? `Inicio de la relación: ${formattedStartDate}` : undefined}
    >
      <svg className="rings-icon" viewBox="0 0 52 28" role="img">
        <circle cx="22" cy="14" r="8.2" />
        <circle cx="32" cy="14" r="8.2" />
        <path d="M21 4.5h4l2 4" />
        <path d="M29 4.5h4l-2 4" />
      </svg>
      {formattedStartDate ? <span className="relationship-date-tooltip">Inicio: {formattedStartDate}</span> : null}
    </span>
  );
}

function TreePerson({
  person,
  selected,
  compact,
  onSelect,
  onAddRelative,
  addLabels,
  lifeLabels,
  displaySettings,
  clinicalConditions,
  clinicalCategories = [],
  canAddParent,
  primaryAnchor,
  timelineVisible = true,
  flagPortraitUrl,
  style
}: {
  person: Person;
  selected: boolean;
  compact?: boolean;
  onSelect: (person: Person) => void;
  onAddRelative: (person: Person, kind: AddRelativeKind) => void;
  addLabels: Record<AddRelativeKind, string>;
  lifeLabels: LifeLabels;
  displaySettings: DisplaySettings;
  clinicalConditions: ClinicalCondition[];
  clinicalCategories?: ClinicalConditionCategory[];
  canAddParent: boolean;
  primaryAnchor?: boolean;
  timelineVisible?: boolean;
  flagPortraitUrl?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`tree-person ${timelineVisible ? "" : "timeline-hidden"}`}
      style={style}
      data-primary-anchor={primaryAnchor ? "true" : undefined}
      data-person-id={person.id}
      data-birth-year={extractBirthYear(person.birthDate) ?? undefined}
      data-timeline-visible={timelineVisible ? "true" : "false"}
    >
      {canAddParent ? (
        <button
          className="tree-add-button add-parent"
          type="button"
          title={addLabels.parent}
          aria-label={addLabels.parent}
          onClick={() => onAddRelative(person, "parent")}
        >
          <Plus size={15} />
        </button>
      ) : null}
      <PersonCard
        person={person}
        selected={selected}
        compact={compact}
        lifeLabels={lifeLabels}
        displaySettings={displaySettings}
        clinicalConditions={clinicalConditions}
        clinicalCategories={clinicalCategories}
        flagPortraitUrl={flagPortraitUrl}
        onSelect={onSelect}
      />
      <button
        className="tree-add-button add-partner"
        type="button"
        title={addLabels.partner}
        aria-label={addLabels.partner}
        onClick={() => onAddRelative(person, "partner")}
      >
        <Plus size={15} />
      </button>
      <button
        className="tree-add-button add-child"
        type="button"
        title={addLabels.child}
        aria-label={addLabels.child}
        onClick={() => onAddRelative(person, "child")}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}
