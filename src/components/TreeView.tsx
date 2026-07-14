import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ClinicalCondition, ClinicalConditionCategory, DisplaySettings, Person, Relationship } from "../domain/types";
import { comparePeopleByBirthDate } from "../tree/layout";
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
};

type BranchSide = "left" | "right";

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
  const stageRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<TreeConnector[]>([]);
  const [generationGuides, setGenerationGuides] = useState<GenerationGuide[]>([]);
  const [connectorSize, setConnectorSize] = useState({ width: 0, height: 0 });
  const nodes = useMemo(() => normalizeTreeNodes(node, fallbackPeople), [node, fallbackPeople]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateConnectors = () => {
      const stageRect = stage.getBoundingClientRect();
      const scaleX = stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1;
      const scaleY = stage.offsetHeight > 0 ? stageRect.height / stage.offsetHeight : scaleX;
      const toLocalX = (value: number) => value / (scaleX || 1);
      const toLocalY = (value: number) => value / (scaleY || 1);
      const nextConnectors: TreeConnector[] = [];
      const nextGenerationYs: number[] = [];
      const nestedParentChildKeys = new Set<string>();

      stage.querySelectorAll<HTMLElement>(".couple-row").forEach((coupleRow) => {
        const coupleRect = coupleRow.getBoundingClientRect();
        nextGenerationYs.push(toLocalY(coupleRect.top - stageRect.top + coupleRect.height / 2));
      });

      stage.querySelectorAll<HTMLElement>("[data-tree-branch-id]").forEach((branch) => {
        const coupleRow = branch.querySelector<HTMLElement>(":scope > .couple-row");
        const childrenRow = branch.querySelector<HTMLElement>(":scope > .children-row");
        if (!coupleRow || !childrenRow) return;

        const childBranches = Array.from(
          childrenRow.querySelectorAll<HTMLElement>(":scope > [data-tree-branch-id]")
        );
        const childAnchors = childBranches
          .map((childBranch) =>
            childBranch.querySelector<HTMLElement>(
              ':scope > .couple-row > .tree-person[data-primary-anchor="true"] .person-card'
            )
          )
          .filter((anchor): anchor is HTMLElement => {
            const treePerson = anchor?.closest<HTMLElement>(".tree-person");
            return Boolean(anchor) && Boolean(treePerson) && treePerson?.dataset.timelineVisible !== "false";
          });

        if (childAnchors.length === 0) return;
        const visibleParentPeople = Array.from(coupleRow.querySelectorAll<HTMLElement>(":scope > .tree-person")).filter(
          (treePerson) => treePerson.dataset.timelineVisible !== "false"
        );
        if (visibleParentPeople.length === 0) return;

        const coupleRect = coupleRow.getBoundingClientRect();
        const childrenRect = childrenRow.getBoundingClientRect();
        const visiblePartnerConnectors = Array.from(
          coupleRow.querySelectorAll<HTMLElement>(":scope .partner-connector:not(.timeline-hidden)")
        );
        const parentAnchorRect =
          visiblePartnerConnectors.length > 0
            ? getCenteredRect(visiblePartnerConnectors.map((element) => element.getBoundingClientRect()))
            : coupleRect;
        let parentX = toLocalX(parentAnchorRect.left - stageRect.left + parentAnchorRect.width / 2);
        const parentBottomY = toLocalY(parentAnchorRect.bottom - stageRect.top);
        const junctionY = toLocalY(childrenRect.top - stageRect.top);
        const childPoints = childAnchors.map((anchor) => {
          const anchorRect = anchor.getBoundingClientRect();
          const childPersonId = anchor.closest<HTMLElement>(".tree-person")?.dataset.personId;
          visibleParentPeople.forEach((parentPerson) => {
            const parentPersonId = parentPerson.dataset.personId;
            if (parentPersonId && childPersonId) {
              nestedParentChildKeys.add(getParentChildKey(parentPersonId, childPersonId));
            }
          });
          return {
            x: toLocalX(anchorRect.left - stageRect.left + anchorRect.width / 2),
            y: toLocalY(anchorRect.top - stageRect.top)
          };
        });
        const singleAlignedChild = childPoints.length === 1 && Math.abs(parentX - childPoints[0].x) < 10;
        if (singleAlignedChild) {
          const childX = childPoints[0].x;
          parentX = childX;
          nextConnectors.push({
            d: `M ${formatCoord(childX)} ${formatCoord(parentBottomY)} V ${formatCoord(childPoints[0].y)}`
          });
          return;
        }
        const horizontalXs = [parentX, ...childPoints.map((point) => point.x)];
        const minX = Math.min(...horizontalXs);
        const maxX = Math.max(...horizontalXs);

        nextConnectors.push({ d: `M ${formatCoord(parentX)} ${formatCoord(parentBottomY)} V ${formatCoord(junctionY)}` });
        if (maxX - minX > 0.5) {
          nextConnectors.push({ d: `M ${formatCoord(minX)} ${formatCoord(junctionY)} H ${formatCoord(maxX)}` });
        }
        childPoints.forEach((point) => {
          nextConnectors.push({
            d: `M ${formatCoord(point.x)} ${formatCoord(junctionY)} V ${formatCoord(point.y)}`
          });
        });

      });

      relationships
        .filter((relationship) => relationship.kind === "parent_child")
        .forEach((relationship) => {
          const relationshipKey = getParentChildKey(relationship.fromPersonId, relationship.toPersonId);
          if (nestedParentChildKeys.has(relationshipKey)) return;

          const parentPerson = stage.querySelector<HTMLElement>(
            `.tree-person[data-person-id="${cssEscape(relationship.fromPersonId)}"]`
          );
          const childPerson = stage.querySelector<HTMLElement>(
            `.tree-person[data-person-id="${cssEscape(relationship.toPersonId)}"]`
          );
          if (
            !parentPerson ||
            !childPerson ||
            parentPerson.dataset.timelineVisible === "false" ||
            childPerson.dataset.timelineVisible === "false"
          ) {
            return;
          }

          const parentCard = parentPerson.querySelector<HTMLElement>(".person-card");
          const childCard = childPerson.querySelector<HTMLElement>(".person-card");
          if (!parentCard || !childCard) return;

          const parentRect = parentCard.getBoundingClientRect();
          const childRect = childCard.getBoundingClientRect();
          const parentX = toLocalX(parentRect.left - stageRect.left + parentRect.width / 2);
          const parentY = toLocalY(parentRect.bottom - stageRect.top);
          const childX = toLocalX(childRect.left - stageRect.left + childRect.width / 2);
          const childY = toLocalY(childRect.top - stageRect.top);
          const midY = parentY < childY ? parentY + (childY - parentY) / 2 : parentY + 28;

          nextConnectors.push({
            d: `M ${formatCoord(parentX)} ${formatCoord(parentY)} V ${formatCoord(midY)} H ${formatCoord(childX)} V ${formatCoord(childY)}`
          });
        });

      setConnectorSize({
        width: Math.max(1, Math.ceil(stage.scrollWidth)),
        height: Math.max(1, Math.ceil(stage.scrollHeight))
      });
      setConnectors(nextConnectors);
      setGenerationGuides(
        getUniqueGenerationYs(nextGenerationYs).map((y, index) => ({
          y,
          label: `${index + 1} GEN`
        }))
      );
    };

    updateConnectors();

    const resizeObserver = new ResizeObserver(updateConnectors);
    resizeObserver.observe(stage);
    stage.querySelectorAll("[data-tree-branch-id], .person-card").forEach((element) => {
      resizeObserver.observe(element);
    });
    window.addEventListener("resize", updateConnectors);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateConnectors);
    };
  }, [nodes, relationships, displaySettings, viewportScale, visiblePersonIds, visiblePartnerRelationshipKeys]);

  if (nodes.length === 0) return null;

  return (
    <div className="tree-stage" ref={stageRef} aria-label="Vertical family tree">
      {displaySettings.showGenerationLines ? (
        <svg
          className="tree-generation-guides-svg"
          width={connectorSize.width}
          height={connectorSize.height}
          viewBox={`0 0 ${connectorSize.width} ${connectorSize.height}`}
          aria-hidden="true"
        >
          {generationGuides.map((guide) => (
            <g key={`${guide.label}-${guide.y}`}>
              <path d={`M 0 ${guide.y} H ${connectorSize.width}`} />
            </g>
          ))}
        </svg>
      ) : null}
      {displaySettings.showGenerationLines ? (
        <div className="tree-generation-labels" aria-hidden="true">
          {generationGuides.map((guide) => (
            <span key={`${guide.label}-${guide.y}`} style={{ top: `${guide.y}px` }}>
              {guide.label}
            </span>
          ))}
        </div>
      ) : null}
      <svg
        className="tree-connectors-svg"
        width={connectorSize.width}
        height={connectorSize.height}
        viewBox={`0 0 ${connectorSize.width} ${connectorSize.height}`}
        aria-hidden="true"
      >
        {connectors.map((connector, index) => (
          <path key={`${connector.d}-${index}`} d={connector.d} />
        ))}
      </svg>
      <div className={nodes.length > 1 ? "tree-forest" : undefined}>
        {nodes.map((branch, index) => (
          <TreeBranch
            key={branch.person?.id ?? `root-${index}`}
            branchKey={branch.person?.id ?? `root-${index}`}
            externalSide={getBranchSide(index, nodes.length)}
            node={branch}
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
  visiblePersonIds,
  visiblePartnerRelationshipKeys,
  flagBackgrounds
}: Omit<TreeViewProps, "node" | "viewportScale"> & { node: TreeNode; branchKey: string; externalSide?: BranchSide }) {
  if (!node.person) {
    if (node.children.length === 0) return null;
    const sortedChildren = sortTreeNodesByBirthDate(node.children);

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
  const sortedChildren = sortTreeNodesByBirthDate(node.children);
  const partnersOnLeft = externalSide === "left";
  const isPersonVisible = isTimelineVisible(person.id, visiblePersonIds);
  const partnerNodes = node.partners.map((partner) => (
    <div className={`couple-partner ${partnersOnLeft ? "partner-left" : ""}`} key={partner.id}>
      <PartnerConnector
        hidden={
          !isPersonVisible ||
          !isTimelineVisible(partner.id, visiblePersonIds) ||
          !isTimelinePartnerVisible(person.id, partner.id, visiblePartnerRelationshipKeys)
        }
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
  ));

  return (
    <div className={`tree-branch ${hasChildren ? "has-children" : ""}`} data-tree-branch-id={branchKey}>
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

function normalizeTreeNodes(node: TreeViewProps["node"], fallbackPeople: Person[]) {
  const nodes = flattenTreeNodes(node).sort((first, second) => compareNullableTreePeople(first.person, second.person));

  if (nodes.length > 0) return nodes;

  return fallbackPeople[0] ? [{ person: fallbackPeople[0], partners: [], children: [] }] : [];
}

function sortTreeNodesByBirthDate(nodes: TreeNode[]) {
  return [...nodes].sort((first, second) => compareNullableTreePeople(first.person, second.person));
}

function flattenTreeNodes(node: TreeViewProps["node"]): TreeNode[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap((child) => flattenTreeNodes(child));
  if (node.person) return [node];
  return node.children.flatMap((child) => flattenTreeNodes(child));
}

function compareNullableTreePeople(first: Person | null, second: Person | null) {
  if (first && second) return comparePeopleByBirthDate(first, second);
  if (first) return -1;
  if (second) return 1;
  return 0;
}

function getUniqueGenerationYs(values: number[]) {
  return values
    .filter((value) => Number.isFinite(value))
    .sort((first, second) => first - second)
    .reduce<number[]>((uniqueValues, value) => {
      const previous = uniqueValues[uniqueValues.length - 1];
      if (previous === undefined || Math.abs(previous - value) > 24) {
        uniqueValues.push(value);
      }
      return uniqueValues;
    }, []);
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

function formatCoord(value: number) {
  return Number(value.toFixed(2));
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

function PartnerConnector({ hidden }: { hidden?: boolean }) {
  return (
    <span className={`partner-connector ${hidden ? "timeline-hidden" : ""}`} aria-hidden="true">
      <svg className="rings-icon" viewBox="0 0 52 28" role="img">
        <circle cx="22" cy="14" r="8.2" />
        <circle cx="32" cy="14" r="8.2" />
        <path d="M21 4.5h4l2 4" />
        <path d="M29 4.5h4l-2 4" />
      </svg>
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
  flagPortraitUrl
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
}) {
  return (
    <div
      className={`tree-person ${timelineVisible ? "" : "timeline-hidden"}`}
      data-primary-anchor={primaryAnchor ? "true" : undefined}
      data-person-id={person.id}
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
