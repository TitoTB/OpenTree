import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parse as parseExif } from "exifr";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Cake,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Fingerprint,
  Flag,
  Heart,
  HeartPulse,
  Hourglass,
  Image,
  ImagePlus,
  Inbox,
  Languages,
  Mail,
  MapPinned,
  Maximize2,
  Moon,
  Palette,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Route,
  Search,
  Star,
  SquareArrowOutUpRight,
  SlidersHorizontal,
  Sun,
  Trash2,
  TreePine,
  Upload,
  Users,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { getLifeStatus, PersonCard } from "./components/PersonCard";
import type { LifeLabels } from "./components/PersonCard";
import { TreeView } from "./components/TreeView";
import type { AddRelativeKind } from "./components/TreeView";
import {
  acceptPendingProjectChange,
  addProjectSyncListener,
  bootstrapProjectStore,
  clearProject,
  loadProject,
  loginToServer,
  logoutFromServer,
  rejectPendingProjectChange,
  saveProject,
  updateServerPasswords,
  updateServerSettings
} from "./services/projectStore";
import type { PendingProjectChange, ServerRole, ServerSettings } from "./services/projectStore";
import { strings } from "./i18n/strings";
import { buildVerticalTree, fullName } from "./tree/layout";
import type {
  ClinicalCondition,
  ClinicalConditionCategory,
  ContributionRecord,
  FamousBirthMatch,
  GivenNameProfile,
  GalleryPhoto,
  GalleryFaceRegion,
  Locale,
  Person,
  PublicInfoLink,
  Relationship,
  SurnameProfile,
  TreeProject,
  WorldHistoryEntry
} from "./domain/types";

type WizardStep = "owner" | "parents";
type PersonProfileTab = "details" | "clinical" | "public" | "stars";
type SettingsTab = "personalization" | "conditions";
type PublicInfoPreview = Pick<PublicInfoLink, "title" | "url" | "snippet" | "imageUrl">;
type MainView =
  | "tree"
  | "ancestors"
  | "people"
  | "surnames"
  | "map"
  | "calendar"
  | "gallery"
  | "conditions"
  | "customization"
  | "contributions";

interface PersonDraft {
  givenName: string;
  familyName: string;
  birthDate: string;
  birthCity: string;
  birthCountry: string;
}

const emptyPersonDraft: PersonDraft = {
  givenName: "",
  familyName: "",
  birthDate: "",
  birthCity: "",
  birthCountry: ""
};

type StarMapProjectedStar = (typeof brightStars)[number] & {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  label: string;
};

interface ZodiacSignInfo {
  key: string;
  symbol: string;
  label: string;
  pageTitle: string;
  sourceUrl: string;
}

export function App() {
  const [project, setProject] = useState<TreeProject | null>(() => loadProject());
  const [serverReady, setServerReady] = useState(false);
  const [serverMode, setServerMode] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [serverRole, setServerRole] = useState<ServerRole>("admin");
  const [serverSettings, setServerSettings] = useState<ServerSettings>({ guestPhotoLimit: 50 });
  const [pendingProjectChanges, setPendingProjectChanges] = useState<PendingProjectChange[]>([]);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [locale, setLocale] = useState<Locale>(project?.locale ?? "es");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(project?.people[0]?.id ?? "");
  const [activeView, setActiveView] = useState<MainView>("tree");
  const [selectedSurname, setSelectedSurname] = useState("");
  const [surnameStatus, setSurnameStatus] = useState("");
  const [nameStatus, setNameStatus] = useState("");
  const [selectedGivenName, setSelectedGivenName] = useState("");
  const [galleryInitialPersonId, setGalleryInitialPersonId] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("personalization");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("owner");
  const [treeName, setTreeName] = useState("Mi familia");
  const [ownerDraft, setOwnerDraft] = useState<PersonDraft>(emptyPersonDraft);
  const [motherDraft, setMotherDraft] = useState<PersonDraft>(emptyPersonDraft);
  const [fatherDraft, setFatherDraft] = useState<PersonDraft>(emptyPersonDraft);
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [personModalEditing, setPersonModalEditing] = useState(false);
  const [personProfileTab, setPersonProfileTab] = useState<PersonProfileTab>("details");
  const [zodiacModalSign, setZodiacModalSign] = useState<ZodiacSignInfo | null>(null);
  const [pendingGalleryUpload, setPendingGalleryUpload] = useState<GalleryPhoto[]>(() => project?.pendingGalleryPhotos ?? []);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [treeZoom, setTreeZoom] = useState(1);
  const [treeTimelineEnabled, setTreeTimelineEnabled] = useState(false);
  const [treeTimelineYear, setTreeTimelineYear] = useState<number | null>(null);
  const [treeTimelinePhotoIndex, setTreeTimelinePhotoIndex] = useState(0);
  const [treeFlagBackgroundsEnabled, setTreeFlagBackgroundsEnabled] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const treeCanvasRef = useRef<HTMLElement | null>(null);
  const treeContentRef = useRef<HTMLDivElement | null>(null);
  const contributionInputRef = useRef<HTMLInputElement>(null);
  const surnameAutoEnrichmentRef = useRef({ running: false, signature: "" });
  const givenNameAutoEnrichmentRef = useRef({ running: false, signature: "" });
  const t = strings[locale];
  const lifeLabels = {
    years: t.years,
    deceased: t.deceased,
    noDate: t.noDate,
    noClinicalConditions: t.noClinicalConditionsShort
  };
  const displaySettings = {
    colorByGender: project?.displaySettings?.colorByGender ?? true,
    showPhotos: project?.displaySettings?.showPhotos ?? true,
    showDeceasedSymbol: project?.displaySettings?.showDeceasedSymbol ?? true,
    showGenerationLines: project?.displaySettings?.showGenerationLines ?? true,
    showSaintDays: project?.displaySettings?.showSaintDays ?? true,
    showClinicalConditions: project?.displaySettings?.showClinicalConditions ?? true,
    darkMode: project?.displaySettings?.darkMode ?? false,
    treeStyle: normalizeTreeStyle(project?.displaySettings?.treeStyle)
  };
  const contributionRequestMessage = project?.contributionRequestMessage ?? t.defaultRequestMessage;

  useEffect(() => {
    let cancelled = false;

    async function loadServerState() {
      const state = await bootstrapProjectStore();
      if (cancelled) return;
      setServerMode(state.serverMode);
      setAuthenticated(state.authenticated);
      setServerRole(state.role ?? "admin");
      setServerSettings(state.settings);
      setPendingProjectChanges(state.pendingProjectChanges);
      if (state.project) {
        setProject(state.project);
        setLocale(state.project.locale);
        setSelectedId(state.project.people[0]?.id ?? "");
      } else if (state.serverMode) {
        setProject(null);
        setSelectedId("");
      }
      setServerReady(true);
    }

    void loadServerState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      addProjectSyncListener((detail) => {
        if (detail.pendingProjectChanges) {
          setPendingProjectChanges(detail.pendingProjectChanges);
        }
        if (detail.project) {
          setProject(detail.project);
          setLocale(detail.project.locale);
          setSelectedId((current) => detail.project?.people.some((person) => person.id === current) ? current : detail.project?.people[0]?.id ?? "");
        }
        if (detail.status === "pending") {
          setSyncStatus("Tu cambio se ha enviado al administrador para su aprobación.");
        } else if (detail.status === "saved") {
          setSyncStatus("");
        } else if (detail.error) {
          setSyncStatus("No se ha podido sincronizar el cambio con el servidor.");
        }
      }),
    []
  );

  useEffect(() => {
    if (serverMode && serverRole === "guest" && activeView === "customization") {
      setActiveView("tree");
    }
  }, [activeView, serverMode, serverRole]);

  const selectedPerson = project?.people.find((person) => person.id === selectedId) ?? project?.people[0];
  const filteredPeople =
    project?.people
      .filter((person) => fullName(person).toLowerCase().includes(query.toLowerCase().trim()))
      .sort((first, second) => fullName(first).localeCompare(fullName(second), "es", { sensitivity: "base" })) ?? [];
  const peopleGenerationLabels = useMemo(
    () => (project ? buildPersonGenerationLabels(project.people, project.relationships) : {}),
    [project]
  );
  const pendingContributions = (project?.contributions ?? []).filter(isPendingContribution);
  const surnameSummaries = useMemo(() => buildSurnameSummaries(project?.people ?? []), [project]);
  const effectiveSelectedSurname = selectedSurname || surnameSummaries[0]?.surname || "";
  const selectedNameProfile = selectedGivenName
    ? project?.nameProfiles?.[normalizeNameKey(selectedGivenName)]
    : undefined;
  const treeTimelineBounds = useMemo(() => getTreeTimelineBounds(project?.people ?? []), [project]);
  const effectiveTreeTimelineYear = treeTimelineYear ?? treeTimelineBounds?.max ?? null;
  const treeTimelinePercent =
    treeTimelineBounds && effectiveTreeTimelineYear !== null && treeTimelineBounds.max > treeTimelineBounds.min
      ? ((effectiveTreeTimelineYear - treeTimelineBounds.min) / (treeTimelineBounds.max - treeTimelineBounds.min)) * 100
      : 100;
  const treeTimelinePhotos: GalleryPhoto[] = [];
  const visibleTreePeople = useMemo(
    () =>
      project
        ? treeTimelineEnabled && effectiveTreeTimelineYear !== null
          ? filterPeopleByTimeline(project.people, effectiveTreeTimelineYear)
          : project.people
        : [],
    [project, treeTimelineEnabled, effectiveTreeTimelineYear]
  );
  const visibleTreePersonIds = useMemo(
    () => (treeTimelineEnabled ? new Set(visibleTreePeople.map((person) => person.id)) : undefined),
    [treeTimelineEnabled, visibleTreePeople]
  );
  const visiblePartnerRelationshipKeys = useMemo(
    () =>
      project && treeTimelineEnabled && effectiveTreeTimelineYear !== null
        ? getVisiblePartnerRelationshipKeys(project.relationships, project.people, effectiveTreeTimelineYear)
        : undefined,
    [project, treeTimelineEnabled, effectiveTreeTimelineYear]
  );
  const tree = useMemo(
    () => (project ? buildVerticalTree(project.people, project.relationships) : null),
    [project]
  );
  const treeFlagBackgrounds = useMemo(
    () =>
      treeFlagBackgroundsEnabled
        ? Object.fromEntries(
            (project?.people ?? [])
              .map((person) => [person.id, getKnownAutonomousCommunityForPerson(person)?.flagUrl ?? ""] as const)
              .filter(([, flagUrl]) => Boolean(flagUrl))
          )
        : undefined,
    [project?.people, treeFlagBackgroundsEnabled]
  );
  const parentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    project?.relationships
      .filter((relationship) => relationship.kind === "parent_child")
      .forEach((relationship) => {
        counts[relationship.toPersonId] = (counts[relationship.toPersonId] ?? 0) + 1;
      });

    return counts;
  }, [project]);

  useEffect(() => {
    if (activeView !== "tree" || !tree) return;

    let innerFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => fitTreeToView());
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(innerFrame);
    };
  }, [activeView, tree]);

  useEffect(() => {
    if (!project) return;

    const summaries = buildSurnameSummaries(project.people);
    const pendingSignature = buildPendingSurnameEnrichmentSignature(summaries, project.surnameProfiles ?? {});
    if (!pendingSignature || pendingSignature === surnameAutoEnrichmentRef.current.signature) return;

    surnameAutoEnrichmentRef.current.signature = pendingSignature;
    void enrichMissingSurnameProfiles({ silent: true });
  }, [project?.people, project?.surnameProfiles]);

  useEffect(() => {
    if (!project) return;

    const pendingSignature = buildPendingGivenNameEnrichmentSignature(project.people, project.nameProfiles ?? {});
    if (!pendingSignature || pendingSignature === givenNameAutoEnrichmentRef.current.signature) return;

    givenNameAutoEnrichmentRef.current.signature = pendingSignature;
    void enrichMissingGivenNameProfiles();
  }, [project?.people, project?.nameProfiles]);

  function switchLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    if (!project) return;

    const nextProject = { ...project, locale: nextLocale };
    setProject(nextProject);
    saveProject(nextProject);
  }

  function selectPerson(person: Person) {
    setSelectedId(person.id);
    setPersonModalEditing(false);
    setPersonProfileTab("details");
    setPersonModalOpen(true);
  }

  function selectPersonStarMap(person: Person) {
    setSelectedId(person.id);
    setPersonModalEditing(false);
    setPersonProfileTab("stars");
    setPersonModalOpen(true);
  }

  function showPeopleView() {
    setActiveView("people");
    setSidebarOpen(false);
  }

  function showMapView() {
    setActiveView("map");
    setSidebarOpen(false);
  }

  function showCalendarView() {
    setActiveView("calendar");
    setSidebarOpen(false);
  }

  function showGalleryView(personId = "") {
    setGalleryInitialPersonId(personId);
    setActiveView("gallery");
    setSidebarOpen(false);
  }

  function openPersonGallery(person: Person) {
    setPersonModalOpen(false);
    setPersonModalEditing(false);
    showGalleryView(person.id);
  }

  function showSurnamesView() {
    setActiveView("surnames");
    setSidebarOpen(false);
  }

  function openSurnameDetail(surname: string) {
    setSelectedSurname(surname);
    setActiveView("surnames");
    setPersonModalOpen(false);
    setPersonModalEditing(false);
    setSidebarOpen(false);
  }

  function openGivenNameDetail(name: string) {
    const firstName = extractFirstGivenName(name);
    if (!firstName) return;

    setSelectedGivenName(firstName);
    setNameStatus("");
  }

  function showTreeView() {
    setActiveView("tree");
    setSidebarOpen(false);
  }

  function showAncestorsView() {
    setActiveView("ancestors");
    setSidebarOpen(false);
  }

  function showContributionsView() {
    setActiveView("contributions");
    setSidebarOpen(false);
  }

  function showCustomizationView() {
    setActiveView("customization");
    setSidebarOpen(false);
  }

  function openConditionCatalog() {
    setSettingsTab("conditions");
    setActiveView("customization");
    setPersonModalOpen(false);
    setPersonModalEditing(false);
    setSidebarOpen(false);
  }

  function beginNewTree() {
    clearProject();
    setProject(null);
    setSelectedId("");
    setQuery("");
    setActiveView("tree");
    setSidebarOpen(false);
    setWizardStep("owner");
    setTreeName(locale === "es" ? "Mi familia" : "My family");
    setOwnerDraft(emptyPersonDraft);
    setMotherDraft(emptyPersonDraft);
    setFatherDraft(emptyPersonDraft);
    setPan({ x: 0, y: 0 });
    setTreeZoom(1);
  }

  async function requestPersonInfo(person: Person) {
    if (!project) return;
    if (person.isDeceased || person.deathDate) {
      window.alert(t.requestOnlyLiving);
      return;
    }

    const requestId = createId("request");
    const fileName = `opentree-solicitud-${slugify(fullName(person) || t.person)}.html`;
    const html = buildContributionRequestHtml({
      requestId,
      projectName: project.name,
      person,
      relatedPeople: getContributionRelatedPeople(person),
      locale,
      personalMessage: contributionRequestMessage,
      logoDataUrl: await loadLogoDataUrl()
    });

    downloadTextFile(fileName, html, "text/html");
    window.alert(t.requestInfoCreated);
  }

  function getContributionRelatedPeople(person: Person) {
    if (!project) return [];

    const peopleById = new Map(project.people.map((candidate) => [candidate.id, candidate]));
    const parentIds = project.relationships
      .filter((relationship) => relationship.kind === "parent_child" && relationship.toPersonId === person.id)
      .map((relationship) => relationship.fromPersonId);
    const childIds = project.relationships
      .filter((relationship) => relationship.kind === "parent_child" && relationship.fromPersonId === person.id)
      .map((relationship) => relationship.toPersonId);
    const partnerIds = project.relationships
      .filter(
        (relationship) =>
          ["partner", "spouse", "former_spouse"].includes(relationship.kind) &&
          (relationship.fromPersonId === person.id || relationship.toPersonId === person.id)
      )
      .map((relationship) =>
        relationship.fromPersonId === person.id ? relationship.toPersonId : relationship.fromPersonId
      );
    const siblingIds = project.relationships
      .filter(
        (relationship) =>
          relationship.kind === "parent_child" &&
          parentIds.includes(relationship.fromPersonId) &&
          relationship.toPersonId !== person.id
      )
      .map((relationship) => relationship.toPersonId);
    const grandchildIds = project.relationships
      .filter((relationship) => relationship.kind === "parent_child" && childIds.includes(relationship.fromPersonId))
      .map((relationship) => relationship.toPersonId);
    const relatedEntries: Array<{ relationshipLabel: string; person: Person }> = [];
    const addedIds = new Set<string>();

    function addRelated(label: string, ids: string[]) {
      [...new Set(ids)]
        .filter((id) => id !== person.id && !addedIds.has(id))
        .forEach((id) => {
          const relatedPerson = peopleById.get(id);
          if (!relatedPerson) return;

          addedIds.add(id);
          relatedEntries.push({ relationshipLabel: label, person: relatedPerson });
        });
    }

    addRelated(t.parents, parentIds);
    addRelated(t.siblings, siblingIds);
    addRelated(t.partners, partnerIds);
    addRelated(t.children, childIds);
    addRelated(t.grandchildren, grandchildIds);

    return relatedEntries;
  }

  async function importContributionFile(file: File) {
    if (!project) return;

    try {
      const parsed = JSON.parse(await file.text()) as Partial<ContributionRecord>;
      const contribution = normalizeContribution(parsed);
      const targetExists = project.people.some((person) => person.id === contribution.targetPersonId);

      if (!targetExists) {
        window.alert(t.contributionUnknownPerson);
        return;
      }

      const nextProject = {
        ...project,
        contributions: [...(project.contributions ?? []), contribution],
        updatedAt: new Date().toISOString()
      };
      setProject(nextProject);
      setActiveView("contributions");
      saveProject(nextProject);
    } catch {
      window.alert(t.contributionImportError);
    } finally {
      if (contributionInputRef.current) {
        contributionInputRef.current.value = "";
      }
    }
  }

  function acceptContribution(contribution: ContributionRecord) {
    if (!project) return;

    const nextProject = {
      ...project,
      people: project.people.map((person) => {
        if (person.id === contribution.targetPersonId) {
          return applyContributionPatch(person, contribution.personPatch);
        }

        const relatedPatch = contribution.relatedPatches?.find((patch) => patch.targetPersonId === person.id);
        return relatedPatch ? applyContributionPatch(person, relatedPatch.personPatch) : person;
      }),
      contributions: (project.contributions ?? []).map((candidate) =>
        candidate.id === contribution.id ? { ...candidate, status: "accepted" as const } : candidate
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function acceptContributionField(
    contribution: ContributionRecord,
    targetPersonId: string,
    field: keyof ContributionRecord["personPatch"]
  ) {
    if (!project) return;

    const patch = getContributionPatchFor(contribution, targetPersonId);
    if (!patch || patch[field] === undefined) return;

    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === targetPersonId ? applyContributionPatch(person, { [field]: patch[field] }) : person
      ),
      contributions: (project.contributions ?? []).map((candidate) =>
        candidate.id === contribution.id ? removeContributionField(candidate, targetPersonId, field) : candidate
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function rejectContributionField(
    contribution: ContributionRecord,
    targetPersonId: string,
    field: keyof ContributionRecord["personPatch"]
  ) {
    if (!project) return;

    const nextProject = {
      ...project,
      contributions: (project.contributions ?? []).map((candidate) =>
        candidate.id === contribution.id ? removeContributionField(candidate, targetPersonId, field) : candidate
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function rejectContribution(contribution: ContributionRecord) {
    if (!project) return;

    const nextProject = {
      ...project,
      contributions: (project.contributions ?? []).map((candidate) =>
        candidate.id === contribution.id ? { ...candidate, status: "rejected" as const } : candidate
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function addRelativeFromTree(person: Person, kind: AddRelativeKind) {
    if (!project) return;

    const id = createId(kind);
    const fallbackName =
      kind === "parent"
        ? locale === "es"
          ? "Nuevo padre/madre"
          : "New parent"
        : kind === "partner"
          ? locale === "es"
            ? "Nueva pareja"
            : "New partner"
          : locale === "es"
            ? "Nuevo hijo/a"
            : "New child";
    const nextPerson: Person = {
      id,
      givenName: fallbackName,
      familyName: "",
      gender: "unknown",
      notes: locale === "es" ? "Completa esta ficha con datos reales." : "Fill this profile with real data.",
      events: []
    };
    const nextRelationships =
      kind === "parent"
        ? buildParentRelationshipsFor(person, id)
        : kind === "child"
          ? buildChildRelationshipsFor(person, id)
          : [
              {
                id: createId("rel"),
                kind: "partner" as const,
                fromPersonId: person.id,
                toPersonId: id
              }
            ];
    const nextProject = {
      ...project,
      people:
        kind === "parent" && nextRelationships.every((relationship) => relationship.fromPersonId !== id)
          ? project.people
          : [...project.people, nextPerson],
      relationships: [...project.relationships, ...nextRelationships],
      updatedAt: new Date().toISOString()
    };
    setProject(nextProject);
    setSelectedId(kind === "parent" && nextRelationships.every((relationship) => relationship.fromPersonId !== id) ? person.id : id);
    setSidebarOpen(kind === "parent" && nextRelationships.every((relationship) => relationship.fromPersonId !== id) ? sidebarOpen : true);
    setPersonModalOpen(!(kind === "parent" && nextRelationships.every((relationship) => relationship.fromPersonId !== id)));
    saveProject(nextProject);
  }

  function buildParentRelationshipsFor(person: Person, newParentId: string) {
    const sharedParentIds = getSiblingSharedParentIds(person.id);

    if (sharedParentIds.length > 0 && window.confirm(t.useSiblingParents)) {
      return sharedParentIds
        .filter((parentId) => !hasParentChildRelationship(parentId, person.id))
        .map((parentId) => ({
          id: createId("rel"),
          kind: "parent_child" as const,
          fromPersonId: parentId,
          toPersonId: person.id
        }));
    }

    return [
      {
        id: createId("rel"),
        kind: "parent_child" as const,
        fromPersonId: newParentId,
        toPersonId: person.id
      }
    ];
  }

  function buildChildRelationshipsFor(parent: Person, childId: string) {
    const partnerIds = project?.relationships
      .filter(
        (relationship) =>
          ["partner", "spouse"].includes(relationship.kind) &&
          (relationship.fromPersonId === parent.id || relationship.toPersonId === parent.id)
      )
      .map((relationship) =>
        relationship.fromPersonId === parent.id ? relationship.toPersonId : relationship.fromPersonId
      ) ?? [];
    const parentIds = [parent.id, ...partnerIds].slice(0, 2);

    return parentIds.map((parentId) => ({
      id: createId("rel"),
      kind: "parent_child" as const,
      fromPersonId: parentId,
      toPersonId: childId
    }));
  }

  function getSiblingSharedParentIds(personId: string) {
    if (!project) return [];

    const currentParentIds = project.relationships
      .filter((relationship) => relationship.kind === "parent_child" && relationship.toPersonId === personId)
      .map((relationship) => relationship.fromPersonId);
    const siblingIds = project.relationships
      .filter(
        (relationship) =>
          relationship.kind === "parent_child" &&
          relationship.toPersonId !== personId &&
          currentParentIds.includes(relationship.fromPersonId)
      )
      .map((relationship) => relationship.toPersonId);
    const candidateParentIds = siblingIds.flatMap((siblingId) =>
      project.relationships
        .filter((relationship) => relationship.kind === "parent_child" && relationship.toPersonId === siblingId)
        .map((relationship) => relationship.fromPersonId)
    );

    return [...new Set(candidateParentIds)].filter((parentId) => !currentParentIds.includes(parentId)).slice(0, 2);
  }

  function hasParentChildRelationship(parentId: string, childId: string) {
    return Boolean(
      project?.relationships.some(
        (relationship) =>
          relationship.kind === "parent_child" &&
          relationship.fromPersonId === parentId &&
          relationship.toPersonId === childId
      )
    );
  }

  function deletePerson(personToDelete: Person) {
    if (!project) return;
    if (!window.confirm(t.confirmDeletePerson.replace("{name}", fullName(personToDelete) || t.person))) return;

    const nextPeople = project.people.filter((person) => person.id !== personToDelete.id);
    const nextProject = {
      ...project,
      people: nextPeople,
      relationships: project.relationships.filter(
        (relationship) =>
          relationship.fromPersonId !== personToDelete.id && relationship.toPersonId !== personToDelete.id
      ),
      updatedAt: new Date().toISOString()
    };
    const nextSelectedId = selectedId === personToDelete.id ? nextPeople[0]?.id ?? "" : selectedId;

    setProject(nextProject);
    setSelectedId(nextSelectedId);
    setPersonModalOpen(false);
    saveProject(nextProject);
  }

  function updateSelectedPerson(patch: Partial<Person>) {
    if (!selectedId) return;

    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const nextProject = {
        ...currentProject,
        people: currentProject.people.map((person) =>
          person.id === selectedId ? { ...person, ...patch } : person
        ),
        updatedAt: new Date().toISOString()
      };

      saveProject(nextProject);
      return nextProject;
    });
  }

  function updateRelationshipStartDate(relationshipId: string, startDate: string) {
    if (!project) return;

    const nextProject = {
      ...project,
      relationships: project.relationships.map((relationship) =>
        relationship.id === relationshipId ? { ...relationship, startDate } : relationship
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function linkClinicalConditionToSelectedPerson(conditionName: string) {
    if (!project || !selectedPerson) return;
    const name = conditionName.trim();
    if (!name) return;

    const existingCondition = project.clinicalConditions?.find(
      (condition) => normalizeClinicalConditionName(condition.name) === normalizeClinicalConditionName(name)
    );
    const now = new Date().toISOString();
    const condition: ClinicalCondition = existingCondition ?? {
      id: createId("condition"),
      name,
      createdAt: now,
      updatedAt: now
    };
    const currentConditionIds = selectedPerson.clinicalConditionIds ?? [];
    const nextConditionIds = currentConditionIds.includes(condition.id)
      ? currentConditionIds
      : [...currentConditionIds, condition.id];
    const nextConditions = existingCondition
      ? project.clinicalConditions ?? []
      : [...(project.clinicalConditions ?? []), condition].sort(compareClinicalConditions);

    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === selectedPerson.id ? { ...person, clinicalConditionIds: nextConditionIds } : person
      ),
      clinicalConditions: nextConditions,
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function unlinkClinicalConditionFromSelectedPerson(conditionId: string) {
    if (!project || !selectedPerson) return;

    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === selectedPerson.id
          ? {
              ...person,
              clinicalConditionIds: (person.clinicalConditionIds ?? []).filter((id) => id !== conditionId)
            }
          : person
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function addPublicInfoLinkToSelectedPerson(
    link: Pick<PublicInfoLink, "title" | "url" | "snippet" | "imageUrl"> & { status?: PublicInfoLink["status"] }
  ) {
    if (!project || !selectedPerson) return;

    const trimmedUrl = link.url.trim();
    if (!trimmedUrl) return;

    const now = new Date().toISOString();
    const nextLink: PublicInfoLink = {
      id: createId("public-link"),
      title: link.title.trim() || trimmedUrl,
      url: trimmedUrl,
      snippet: link.snippet?.trim(),
      imageUrl: link.imageUrl?.trim(),
      status: link.status ?? "pending",
      createdAt: now
    };
    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === selectedPerson.id
          ? { ...person, publicInfoLinks: [...(person.publicInfoLinks ?? []), nextLink] }
          : person
      ),
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateSelectedPersonPublicLink(linkId: string, patch: Partial<PublicInfoLink>) {
    if (!project || !selectedPerson) return;

    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === selectedPerson.id
          ? {
              ...person,
              publicInfoLinks: (person.publicInfoLinks ?? []).map((link) =>
                link.id === linkId ? { ...link, ...patch } : link
              )
            }
          : person
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function removeSelectedPersonPublicLink(linkId: string) {
    if (!project || !selectedPerson) return;

    const nextProject = {
      ...project,
      people: project.people.map((person) =>
        person.id === selectedPerson.id
          ? { ...person, publicInfoLinks: (person.publicInfoLinks ?? []).filter((link) => link.id !== linkId) }
          : person
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateClinicalCondition(conditionId: string, patch: Partial<ClinicalCondition>) {
    if (!project) return;

    const nextProject = {
      ...project,
      clinicalConditions: (project.clinicalConditions ?? []).map((condition) =>
        condition.id === conditionId ? { ...condition, ...patch, updatedAt: new Date().toISOString() } : condition
      ),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function addClinicalConditionCategory() {
    if (!project) return;
    const now = new Date().toISOString();
    const category: ClinicalConditionCategory = {
      id: createId("condition-category"),
      name: t.newClinicalCategory,
      color: getNextClinicalCategoryColor(project.clinicalConditionCategories ?? []),
      createdAt: now,
      updatedAt: now
    };
    const nextProject = {
      ...project,
      clinicalConditionCategories: [...(project.clinicalConditionCategories ?? []), category],
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateClinicalConditionCategory(categoryId: string, patch: Partial<ClinicalConditionCategory>) {
    if (!project) return;
    const now = new Date().toISOString();
    const nextProject = {
      ...project,
      clinicalConditionCategories: (project.clinicalConditionCategories ?? []).map((category) =>
        category.id === categoryId ? { ...category, ...patch, updatedAt: now } : category
      ),
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function deleteClinicalConditionCategory(categoryId: string) {
    if (!project) return;
    const now = new Date().toISOString();
    const nextProject = {
      ...project,
      clinicalConditionCategories: (project.clinicalConditionCategories ?? []).filter((category) => category.id !== categoryId),
      clinicalConditions: (project.clinicalConditions ?? []).map((condition) =>
        condition.categoryId === categoryId ? { ...condition, categoryId: undefined, updatedAt: now } : condition
      ),
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  async function enrichClinicalConditionFromPublicSource(conditionId: string) {
    if (!project) return;
    const condition = project.clinicalConditions?.find((item) => item.id === conditionId);
    if (!condition) return;

    let profile: Awaited<ReturnType<typeof fetchMayoClinicConditionProfile>>;
    try {
      profile = await fetchMayoClinicConditionProfile(condition.name);
      if (!profile) {
        window.alert(t.clinicalConditionFetchEmpty);
        return;
      }
    } catch (error) {
      window.alert(`${t.clinicalConditionFetchError}\n${error instanceof Error ? error.message : ""}`.trim());
      return;
    }

    updateClinicalCondition(conditionId, {
      description: profile.summary,
      symptoms: profile.symptoms,
      sourceName: profile.sourceName,
      sourceUrl: profile.sourceUrl
    });
  }

  async function addGalleryFiles(files: FileList | File[]) {
    if (!project) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    const now = new Date().toISOString();
    const photos = await Promise.all(imageFiles.map((file) => buildGalleryPhotoFromFile(file, now)));
    if (photos.some((photo) => !hasGalleryPhotoCoordinates(photo))) {
      savePendingGalleryPhotos(photos);
      return;
    }

    saveGalleryPhotos(photos, now);
  }

  function saveGalleryPhotos(photos: GalleryPhoto[], timestamp = new Date().toISOString()) {
    if (!project) return false;
    const nextProject = {
      ...project,
      galleryPhotos: [...(project.galleryPhotos ?? []), ...photos],
      pendingGalleryPhotos: [],
      updatedAt: timestamp
    };

    if (!saveProject(nextProject)) return false;
    setProject(nextProject);
    return true;
  }

  function updatePendingGalleryPhoto(photoId: string, patch: Partial<GalleryPhoto>) {
    const nextPhotos = pendingGalleryUpload.map((photo) =>
      photo.id === photoId ? { ...photo, ...patch, updatedAt: new Date().toISOString() } : photo
    );
    savePendingGalleryPhotos(nextPhotos);
  }

  function confirmPendingGalleryUpload() {
    if (pendingGalleryUpload.some((photo) => !hasGalleryPhotoCoordinates(photo))) return;
    if (saveGalleryPhotos(pendingGalleryUpload)) {
      setPendingGalleryUpload([]);
    }
  }

  function cancelPendingGalleryUpload() {
    savePendingGalleryPhotos([]);
  }

  function savePendingGalleryPhotos(photos: GalleryPhoto[]) {
    if (!project) return;
    const nextProject = {
      ...project,
      pendingGalleryPhotos: photos,
      updatedAt: new Date().toISOString()
    };

    if (!saveProject(nextProject)) return;
    setProject(nextProject);
    setPendingGalleryUpload(photos);
  }

  function updateGalleryPhoto(photoId: string, patch: Partial<GalleryPhoto>) {
    if (!project) return;
    const now = new Date().toISOString();
    const nextProject = {
      ...project,
      galleryPhotos: (project.galleryPhotos ?? []).map((photo) =>
        photo.id === photoId ? { ...photo, ...patch, updatedAt: now } : photo
      ),
      updatedAt: now
    };

    if (!saveProject(nextProject)) return;
    setProject(nextProject);
  }

  async function resolveGalleryPhotoLocation(photoId: string, locationText?: string) {
    if (!project) return;
    const photo = (project.galleryPhotos ?? []).find((item) => item.id === photoId);
    const address = (locationText ?? photo?.location ?? "").trim();
    if (!photo || !address) return;

    try {
      const location = await geocodeAddress(address);
      if (!location?.coords) return;
      updateGalleryPhoto(photoId, {
        latitude: location.coords.lat,
        longitude: location.coords.lng
      });
    } catch {
      // The map keeps working offline; unresolved locations simply remain without coordinates.
    }
  }

  async function resolveMissingGalleryPhotoLocations() {
    if (!project) return;
    const candidates = (project.galleryPhotos ?? []).filter(
      (photo) => photo.location?.trim() && !hasGalleryPhotoCoordinates(photo)
    );
    if (candidates.length === 0) return;

    const resolvedLocations: Record<string, { latitude: number; longitude: number }> = {};

    for (let index = 0; index < candidates.length; index += 1) {
      const photo = candidates[index];
      try {
        const location = await geocodeAddress(photo.location ?? "");
        if (location?.coords) {
          resolvedLocations[photo.id] = {
            latitude: location.coords.lat,
            longitude: location.coords.lng
          };
        }
      } catch {
        // Keep unresolved photos visible in the gallery; only the map filter needs coordinates.
      }
      if (index < candidates.length - 1) {
        await sleep(900);
      }
    }

    if (Object.keys(resolvedLocations).length === 0) return;

    const now = new Date().toISOString();
    const nextProject = {
      ...project,
      galleryPhotos: (project.galleryPhotos ?? []).map((photo) =>
        resolvedLocations[photo.id] ? { ...photo, ...resolvedLocations[photo.id], updatedAt: now } : photo
      ),
      updatedAt: now
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function deleteGalleryPhoto(photoId: string) {
    if (!project) return;
    const nextProject = {
      ...project,
      galleryPhotos: (project.galleryPhotos ?? []).filter((photo) => photo.id !== photoId),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  async function setPersonPhotoFromGallery(photo: GalleryPhoto, personId: string) {
    if (!project) return;

    const region = (photo.faceRegions ?? []).find((faceRegion) => faceRegion.personId === personId);
    const photoUrl = region ? await cropGalleryPhotoRegion(photo.dataUrl, region) : photo.dataUrl;
    const nextProject = {
      ...project,
      people: project.people.map((person) => (person.id === personId ? { ...person, photoUrl } : person)),
      updatedAt: new Date().toISOString()
    };

    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateDisplaySettings(patch: Partial<NonNullable<TreeProject["displaySettings"]>>) {
    if (!project) return;

    const nextProject = {
      ...project,
      displaySettings: {
        ...displaySettings,
        ...patch
      },
      updatedAt: new Date().toISOString()
    };
    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateContributionRequestMessage(message: string) {
    if (!project) return;

    const nextProject = {
      ...project,
      contributionRequestMessage: message,
      updatedAt: new Date().toISOString()
    };
    setProject(nextProject);
    saveProject(nextProject);
  }

  function updateSurnameProfile(surname: string, patch: Partial<SurnameProfile>) {
    if (!project) return;
    const key = normalizeSurnameKey(surname);
    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const currentProfile = currentProject.surnameProfiles?.[key] ?? { surname };
      const nextProject = {
        ...currentProject,
        surnameProfiles: {
          ...(currentProject.surnameProfiles ?? {}),
          [key]: {
            ...currentProfile,
            surname,
            ...patch
          }
        },
        updatedAt: new Date().toISOString()
      };

      saveProject(nextProject);
      return nextProject;
    });
  }

  function updateNameProfile(name: string, profile: GivenNameProfile) {
    if (!project) return;

    const key = normalizeNameKey(name);
    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const nextProject = {
        ...currentProject,
        nameProfiles: {
          ...(currentProject.nameProfiles ?? {}),
          [key]: profile
        },
        updatedAt: new Date().toISOString()
      };

      saveProject(nextProject);
      return nextProject;
    });
  }

  function saveWorldHistoryEvents(cacheKey: string, entries: WorldHistoryEntry[]) {
    if (!project) return;
    const usefulEntries = entries.filter(isUsefulWorldHistoryEntry);

    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const nextProject = {
        ...currentProject,
        worldHistoryEvents: {
          ...(currentProject.worldHistoryEvents ?? {}),
          [cacheKey]: usefulEntries
        },
        updatedAt: new Date().toISOString()
      };

      saveProject(nextProject);
      return nextProject;
    });
  }

  function saveFamousBirth(cacheKey: string, match: FamousBirthMatch | null) {
    if (!project) return;

    setProject((currentProject) => {
      if (!currentProject) return currentProject;
      const nextProject = {
        ...currentProject,
        famousBirths: {
          ...(currentProject.famousBirths ?? {}),
          [cacheKey]: match
        },
        updatedAt: new Date().toISOString()
      };

      saveProject(nextProject);
      return nextProject;
    });
  }

  async function fetchIneSurnameData(surname: string) {
    if (!project) return;
    setSurnameStatus(t.loadingIneSurname);

    try {
      const ine = await fetchIneSurnameStats(surname);
      updateSurnameProfile(surname, { ine });
      setSurnameStatus(t.ineSurnameSaved);
    } catch {
      setSurnameStatus(t.ineSurnameError);
    }
  }

  async function fetchForebearsSurnameData(surname: string) {
    if (!project) return;
    setSurnameStatus(t.loadingForebearsSurname);

    try {
      const forebears = await fetchForebearsSurnameStats(surname);
      updateSurnameProfile(surname, { forebears });
      setSurnameStatus(t.forebearsSurnameSaved);
    } catch {
      setSurnameStatus(t.forebearsSurnameError);
    }
  }

  async function fetchSurnameOriginData(surname: string) {
    if (!project) return;
    setSurnameStatus(t.loadingSurnameOrigins);

    try {
      const originSuggestions = await fetchSurnameOriginSuggestions(surname);
      if (originSuggestions.length === 0) {
        setSurnameStatus(t.surnameOriginsEmpty);
        return;
      }

      updateSurnameProfile(surname, { originSuggestions });
      setSurnameStatus(t.surnameOriginsSaved);
    } catch (error) {
      console.error(error);
      setSurnameStatus(t.surnameOriginsError);
    }
  }

  async function fetchSurnameMeaningData(surname: string) {
    if (!project) return;
    setSurnameStatus(t.loadingSurnameMeaning);

    try {
      const suggestion = await fetchGeneanetSurnameMeaningSuggestion(surname);
      if (!suggestion?.meaning) {
        setSurnameStatus(t.surnameMeaningEmpty);
        return;
      }

      updateSurnameProfile(surname, {
        meaning: suggestion.meaning,
        originSourceName: suggestion.sourceName,
        originSourceUrl: suggestion.sourceUrl
      });
      setSurnameStatus(t.surnameMeaningSaved);
    } catch (error) {
      console.error(error);
      setSurnameStatus(t.surnameMeaningError);
    }
  }

  async function fetchAllSurnameMeaningsData() {
    await enrichMissingSurnameProfiles({ silent: false });
  }

  async function enrichMissingSurnameProfiles({ silent }: { silent: boolean }) {
    if (!project) return;
    if (surnameAutoEnrichmentRef.current.running) return;

    const summaries = buildSurnameSummaries(project.people);
    const pendingSummaries = summaries.filter((summary) => {
      const profile = project.surnameProfiles?.[normalizeSurnameKey(summary.surname)];
      return (
        !profile?.ine ||
        !profile?.forebears ||
        !profile?.coatOfArmsUrl ||
        needsSurnameMeaningRefresh(profile?.meaning, summary.surname)
      );
    });

    if (pendingSummaries.length === 0) {
      if (!silent) setSurnameStatus(t.allSurnameDataAlreadySaved);
      return;
    }

    surnameAutoEnrichmentRef.current.running = true;
    let nextProfiles = { ...(project.surnameProfiles ?? {}) };
    let statsSavedCount = 0;
    let internationalSavedCount = 0;
    let meaningSavedCount = 0;
    let failedCount = 0;

    try {
      for (let index = 0; index < pendingSummaries.length; index += 1) {
        const summary = pendingSummaries[index];
        const key = normalizeSurnameKey(summary.surname);
        const currentProfile = nextProfiles[key] ?? { surname: summary.surname };
        let profilePatch: Partial<SurnameProfile> = {};

        if (!silent) {
          setSurnameStatus(
            t.loadingAllSurnameData
              .replace("{current}", String(index + 1))
              .replace("{total}", String(pendingSummaries.length))
              .replace("{surname}", summary.surname)
          );
        }

        if (!currentProfile.ine) {
          try {
            profilePatch.ine = await fetchIneSurnameStats(summary.surname);
            statsSavedCount += 1;
          } catch (error) {
            console.error(error);
            failedCount += 1;
          }
        }

        if (!currentProfile.forebears) {
          try {
            profilePatch.forebears = await fetchForebearsSurnameStats(summary.surname);
            internationalSavedCount += 1;
          } catch (error) {
            console.error(error);
            failedCount += 1;
          }
        }

        if (!currentProfile.coatOfArmsUrl) {
          try {
            const coatOfArms = await fetchHeraldicaFamiliarCoatOfArms(summary.surname);
            profilePatch = {
              ...profilePatch,
              ...coatOfArms
            };
          } catch (error) {
            console.error(error);
            failedCount += 1;
          }
        }

        if (needsSurnameMeaningRefresh(currentProfile.meaning, summary.surname)) {
          try {
            const suggestion = await fetchGeneanetSurnameMeaningSuggestion(summary.surname);
            if (!suggestion?.meaning) {
              failedCount += 1;
            } else {
              profilePatch = {
                ...profilePatch,
                meaning: suggestion.meaning,
                originSourceName: suggestion.sourceName,
                originSourceUrl: suggestion.sourceUrl
              };
              meaningSavedCount += 1;
            }
          } catch (error) {
            console.error(error);
            failedCount += 1;
          }
        }

        if (Object.keys(profilePatch).length > 0) {
          nextProfiles = {
            ...nextProfiles,
            [key]: {
              ...currentProfile,
              ...profilePatch,
              surname: summary.surname
            }
          };

          const savedProfile = nextProfiles[key];
          setProject((currentProject) => {
            if (!currentProject) return currentProject;
            const nextProject = {
              ...currentProject,
              surnameProfiles: {
                ...(currentProject.surnameProfiles ?? {}),
                [key]: {
                  ...(currentProject.surnameProfiles?.[key] ?? { surname: summary.surname }),
                  ...savedProfile
                }
              },
              updatedAt: new Date().toISOString()
            };

            saveProject(nextProject);
            return nextProject;
          });
        }

        if (index < pendingSummaries.length - 1) {
          await sleep(700);
        }
      }
    } finally {
      surnameAutoEnrichmentRef.current.running = false;
    }

    if (!silent) {
      setSurnameStatus(
        t.allSurnameDataFinished
          .replace("{stats}", String(statsSavedCount))
          .replace("{international}", String(internationalSavedCount))
          .replace("{meanings}", String(meaningSavedCount))
          .replace("{failed}", String(failedCount))
      );
    }
  }

  function acceptSurnameOriginSuggestion(surname: string, suggestionId: string) {
    if (!project) return;

    const key = normalizeSurnameKey(surname);
    const profile = project.surnameProfiles?.[key];
    const suggestion = profile?.originSuggestions?.find((item) => item.id === suggestionId);
    if (!profile || !suggestion) return;

    updateSurnameProfile(surname, {
      origin: suggestion.origin || suggestion.excerpt || profile?.origin,
      meaning: suggestion.meaning || profile?.meaning,
      originSourceName: suggestion.sourceName,
      originSourceUrl: suggestion.sourceUrl,
      originSuggestions: (profile.originSuggestions ?? []).filter((item) => item.id !== suggestionId)
    });
    setSurnameStatus(t.surnameOriginAccepted);
  }

  function rejectSurnameOriginSuggestion(surname: string, suggestionId: string) {
    if (!project) return;

    const key = normalizeSurnameKey(surname);
    const profile = project.surnameProfiles?.[key];
    updateSurnameProfile(surname, {
      originSuggestions: (profile?.originSuggestions ?? []).filter((item) => item.id !== suggestionId)
    });
    setSurnameStatus(t.surnameOriginRejected);
  }

  async function fetchGivenNameMeaning(name: string) {
    if (!project) return;

    setNameStatus(t.loadingNameMeaning);
    try {
      const profile = await fetchFirstNameMeaningProfile(name);
      updateNameProfile(name, profile);
      setNameStatus(t.nameMeaningSaved);
    } catch (error) {
      console.error(error);
      setNameStatus(t.nameMeaningError);
    }
  }

  async function enrichMissingGivenNameProfiles() {
    if (!project || givenNameAutoEnrichmentRef.current.running) return;

    const pendingNames = buildPendingGivenNameList(project.people, project.nameProfiles ?? {});
    if (pendingNames.length === 0) return;

    givenNameAutoEnrichmentRef.current.running = true;
    let nextProfiles = { ...(project.nameProfiles ?? {}) };

    try {
      for (let index = 0; index < pendingNames.length; index += 1) {
        const name = pendingNames[index];
        try {
          const profile = await fetchFirstNameMeaningProfile(name);
          nextProfiles = {
            ...nextProfiles,
            [normalizeNameKey(name)]: profile
          };

          setProject((currentProject) => {
            if (!currentProject) return currentProject;
            const nextProject = {
              ...currentProject,
              nameProfiles: {
                ...(currentProject.nameProfiles ?? {}),
                [normalizeNameKey(name)]: profile
              },
              updatedAt: new Date().toISOString()
            };

            saveProject(nextProject);
            return nextProject;
          });
        } catch (error) {
          console.error(error);
        }

        if (index < pendingNames.length - 1) {
          await sleep(450);
        }
      }
    } finally {
      const remainingNames = buildPendingGivenNameList(project.people, nextProfiles);
      if (remainingNames.length > 0) {
        givenNameAutoEnrichmentRef.current.signature = "";
      }
      givenNameAutoEnrichmentRef.current.running = false;
    }
  }

  function updateTreeZoom(delta: number) {
    setTreeZoom((currentZoom) => clampZoom(currentZoom + delta));
  }

  function fitTreeToView() {
    const canvas = treeCanvasRef.current;
    const content = treeContentRef.current;
    if (!canvas || !content) return;

    const canvasRect = canvas.getBoundingClientRect();
    const unscaledWidth = content.scrollWidth;
    const unscaledHeight = content.scrollHeight;
    if (unscaledWidth === 0 || unscaledHeight === 0) return;

    const availableWidth = Math.max(320, canvasRect.width - 140);
    const availableHeight = Math.max(260, canvasRect.height - 190);
    const nextZoom = clampZoom(Math.min(1, availableWidth / unscaledWidth, availableHeight / unscaledHeight));
    const contentLeft = content.offsetLeft;
    const contentTop = content.offsetTop;
    const scaledCenterX = (contentLeft + unscaledWidth / 2) * nextZoom;
    const scaledCenterY = (contentTop + unscaledHeight / 2) * nextZoom;
    const targetCenterX = canvasRect.width / 2;
    const targetCenterY = canvasRect.height / 2 + 24;

    setTreeZoom(nextZoom);
    setPan({
      x: targetCenterX - scaledCenterX,
      y: targetCenterY - scaledCenterY
    });
  }

  function printCurrentTreeToPdf() {
    window.requestAnimationFrame(() => window.print());
  }

  function createFirstTree() {
    const now = new Date().toISOString();
    const ownerId = createId("owner");
    const motherId = createId("mother");
    const fatherId = createId("father");
    const people: Person[] = [
      draftToPerson(
        ownerId,
        ownerDraft,
        "unknown",
        locale === "es" ? "Persona principal" : "Main person",
        locale === "es" ? "Persona inicial del árbol." : "Starting person."
      )
    ];
    const relationships = [];

    if (hasDraftData(motherDraft)) {
      people.push(draftToPerson(motherId, motherDraft, "female", locale === "es" ? "Madre" : "Mother"));
      relationships.push({
        id: createId("rel"),
        kind: "parent_child" as const,
        fromPersonId: motherId,
        toPersonId: ownerId
      });
    }

    if (hasDraftData(fatherDraft)) {
      people.push(draftToPerson(fatherId, fatherDraft, "male", locale === "es" ? "Padre" : "Father"));
      relationships.push({
        id: createId("rel"),
        kind: "parent_child" as const,
        fromPersonId: fatherId,
        toPersonId: ownerId
      });
    }

    if (hasDraftData(motherDraft) && hasDraftData(fatherDraft)) {
      relationships.push({
        id: createId("rel"),
        kind: "partner" as const,
        fromPersonId: motherId,
        toPersonId: fatherId
      });
    }

    const nextProject: TreeProject = {
      id: createId("tree"),
      name: treeName.trim() || (locale === "es" ? "Mi familia" : "My family"),
      locale,
      people,
      relationships,
      displaySettings: {
        colorByGender: true,
        showPhotos: true,
        showDeceasedSymbol: true,
        showGenerationLines: true,
        showSaintDays: true,
        showClinicalConditions: true,
        darkMode: false
      },
      contributionRequestMessage: t.defaultRequestMessage,
      createdAt: now,
      updatedAt: now
    };

    setProject(nextProject);
    setSelectedId(ownerId);
    setPan({ x: 0, y: 0 });
    setTreeZoom(1);
    saveProject(nextProject);
  }

  if (!serverReady) {
    return (
      <main className="wizard-screen">
        <section className="wizard-shell">
          <div className="wizard-brand">
            <img className="brand-logo" src="/opentree-logo.png" alt="OpenTree" />
          </div>
          <div className="wizard-copy">
            <span className="eyebrow">OpenTree</span>
            <h2>Cargando...</h2>
          </div>
        </section>
      </main>
    );
  }

  if (serverMode && !authenticated) {
    return (
      <LoginScreen
        authError={authError}
        onLogin={async (role, password) => {
          setAuthError("");
          try {
            const state = await loginToServer(role, password);
            setAuthenticated(state.authenticated);
            setServerRole(state.role ?? role);
            setServerSettings(state.settings);
            setPendingProjectChanges(state.pendingProjectChanges);
            setProject(state.project);
            setLocale(state.project?.locale ?? "es");
            setSelectedId(state.project?.people[0]?.id ?? "");
          } catch {
            setAuthError("Credenciales incorrectas.");
          }
        }}
      />
    );
  }

  if (serverMode && serverRole === "guest" && !project) {
    return (
      <main className="wizard-screen">
        <section className="wizard-shell">
          <div className="wizard-brand">
            <img className="brand-logo" src="/opentree-logo.png" alt="OpenTree" />
          </div>
          <div className="wizard-copy">
            <span className="eyebrow">OpenTree</span>
            <h2>Árbol pendiente de crear</h2>
            <p>Un administrador debe crear el primer árbol antes de que el perfil invitado pueda aportar información.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={async () => {
              await logoutFromServer();
              setAuthenticated(false);
              setProject(null);
            }}
          >
            Cambiar de usuario
          </button>
        </section>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="wizard-screen">
        <section className="wizard-shell">
          <div className="wizard-brand">
            <img className="brand-logo" src="/opentree-logo.png" alt="OpenTree" />
          </div>

          <div className="wizard-copy">
            <span className="eyebrow">{wizardStep === "owner" ? t.yourDetails : t.parentDetails}</span>
            <h2>{t.startWizardTitle}</h2>
            <p>{t.startWizardIntro}</p>
          </div>

          {wizardStep === "owner" ? (
            <form
              className="wizard-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                setWizardStep("parents");
              }}
            >
              <label>
                <span>{t.projectName}</span>
                <input value={treeName} onChange={(event) => setTreeName(event.target.value)} />
              </label>
              <DraftFields draft={ownerDraft} setDraft={setOwnerDraft} t={t} />
              <div className="wizard-actions">
                <LanguageButtons locale={locale} switchLocale={switchLocale} />
                <button
                  className="primary-action"
                  type="submit"
                >
                  {t.continue}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="wizard-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                createFirstTree();
              }}
            >
              <div className="parent-grid">
                <section>
                  <h3>{t.mother}</h3>
                  <DraftFields draft={motherDraft} setDraft={setMotherDraft} t={t} />
                </section>
                <section>
                  <h3>{t.father}</h3>
                  <DraftFields draft={fatherDraft} setDraft={setFatherDraft} t={t} />
                </section>
              </div>
              <div className="wizard-actions">
                <button type="button" onClick={() => setWizardStep("owner")}>
                  {t.back}
                </button>
                <button className="primary-action" type="submit">
                  {t.createTree}
                </button>
              </div>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={`app-frame ${sidebarOpen ? "sidebar-open" : ""} ${displaySettings.darkMode ? "theme-dark" : ""}`}>
      <aside className="rail">
        <button className="rail-button brand-button" type="button" onClick={() => setSidebarOpen(!sidebarOpen)} title={t.menu}>
          <img src="/opentree-favicon.png" alt="" />
          <span>OpenTree</span>
        </button>

        <div className="rail-actions">
          <button
            className={activeView === "tree" ? "active" : ""}
            type="button"
            title={t.treeMap}
            onClick={showTreeView}
          >
            <TreePine size={20} />
            <span>{t.treeMap}</span>
          </button>
          <button
            className={activeView === "map" ? "active" : ""}
            type="button"
            title={t.birthMap}
            onClick={showMapView}
          >
            <FontAwesomeEarthEuropeIcon size={20} />
            <span>{t.birthMap}</span>
          </button>
          <button
            className={activeView === "calendar" ? "active" : ""}
            type="button"
            title={t.calendar}
            onClick={showCalendarView}
          >
            <CalendarDays size={20} />
            <span>{t.calendar}</span>
          </button>
          <button
            className={activeView === "gallery" ? "active" : ""}
            type="button"
            title={t.gallery}
            onClick={() => showGalleryView()}
          >
            <Image size={20} />
            <span>{t.gallery}</span>
          </button>
          <button
            className={activeView === "contributions" ? "active" : ""}
            type="button"
            title={t.contributionInbox}
            onClick={showContributionsView}
          >
            <Inbox size={20} />
            <span>{t.contributionInbox}</span>
          </button>
          {serverRole === "admin" ? (
            <button
              className={activeView === "customization" ? "active" : ""}
              type="button"
              title={t.customization}
              onClick={showCustomizationView}
            >
              <SlidersHorizontal size={20} />
              <span>{t.customization}</span>
            </button>
          ) : null}
          {serverMode ? (
            <button
              type="button"
              title="Salir"
              onClick={async () => {
                await logoutFromServer();
                setAuthenticated(false);
                setProject(null);
              }}
            >
              <X size={20} />
              <span>Salir</span>
            </button>
          ) : null}
        </div>

        <div className="expanded-menu" />
      </aside>

      {syncStatus ? <div className="sync-toast">{syncStatus}</div> : null}

      {activeView === "tree" ? (
        <section
          ref={treeCanvasRef}
          className={`tree-canvas tree-style-${displaySettings.treeStyle} ${
            displaySettings.showGenerationLines ? "has-generation-lines" : ""
          }`}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button, input, .tree-controls-stack")) return;
            setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
          }}
          onWheel={(event) => {
            event.preventDefault();
            updateTreeZoom(event.deltaY > 0 ? -0.08 : 0.08);
          }}
          onPointerMove={(event) => {
            if (!dragStart) return;
            setPan({
              x: dragStart.panX + event.clientX - dragStart.x,
              y: dragStart.panY + event.clientY - dragStart.y
            });
          }}
          onPointerUp={() => setDragStart(null)}
          onPointerLeave={() => setDragStart(null)}
        >
          <header className="canvas-header">
            <h1>{t.treeMap}</h1>
            <div className="tree-header-actions" aria-label={t.treeMap}>
              <button className="tree-header-action" type="button" onClick={showAncestorsView}>
                <Search size={15} />
                <span>{t.ancestors}</span>
              </button>
              <button className="tree-header-action" type="button" onClick={showSurnamesView}>
                <FontAwesomeShieldIcon size={15} />
                <span>{t.surnames}</span>
              </button>
              <button className="tree-header-action" type="button" onClick={showPeopleView}>
                <Users size={15} />
                <span>{t.people}</span>
              </button>
            </div>
          </header>
          <div className="tree-pan" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${treeZoom})` }}>
            <div ref={treeContentRef}>
            <TreeView
              node={tree}
              fallbackPeople={project.people}
              selectedId={selectedId}
                onSelect={selectPerson}
                onAddRelative={addRelativeFromTree}
                addLabels={{
                  parent: t.addParent,
                  partner: t.addPartner,
                  child: t.addChild
                }}
                lifeLabels={lifeLabels}
                displaySettings={displaySettings}
                clinicalConditions={project.clinicalConditions ?? []}
                clinicalCategories={project.clinicalConditionCategories ?? []}
                parentCounts={parentCounts}
                viewportScale={treeZoom}
                visiblePersonIds={visibleTreePersonIds}
                visiblePartnerRelationshipKeys={visiblePartnerRelationshipKeys}
                flagBackgrounds={treeFlagBackgrounds}
              />
            </div>
          </div>
          <div className="tree-bottom-dock">
            {treeTimelineEnabled && treeTimelinePhotos.length > 0 ? (
              <section className="tree-timeline-gallery" aria-label={t.gallery}>
                <button
                  type="button"
                  title="Anterior"
                  aria-label="Anterior"
                  onClick={() =>
                    setTreeTimelinePhotoIndex((index) =>
                      treeTimelinePhotos.length > 0 ? (index - 1 + treeTimelinePhotos.length) % treeTimelinePhotos.length : 0
                    )
                  }
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="tree-timeline-gallery-strip">
                  <div
                    className="tree-timeline-gallery-track"
                    style={{ "--tree-photo-index": treeTimelinePhotoIndex } as CSSProperties}
                  >
                    {treeTimelinePhotos.map((photo) => (
                      <figure className="tree-timeline-gallery-thumb" key={photo.id}>
                        <img
                          src={photo.dataUrl}
                          alt={photo.title || photo.fileName || t.galleryPhoto}
                          title={`${photo.title || photo.fileName || t.galleryPhoto} · ${formatGalleryMeta(photo, t)}`}
                        />
                      </figure>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  title="Siguiente"
                  aria-label="Siguiente"
                  onClick={() =>
                    setTreeTimelinePhotoIndex((index) =>
                      treeTimelinePhotos.length > 0 ? (index + 1) % treeTimelinePhotos.length : 0
                    )
                  }
                >
                  <ChevronRight size={18} />
                </button>
              </section>
            ) : null}
            <div className="tree-controls-stack">
              {treeTimelineEnabled && treeTimelineBounds ? (
                <div className="tree-timeline-panel">
                  <span>{treeTimelineBounds.min}</span>
                  <div className="tree-timeline-slider">
                    <output className="tree-timeline-bubble" style={{ left: `${treeTimelinePercent}%` }}>
                      {effectiveTreeTimelineYear ?? treeTimelineBounds.max}
                    </output>
                    <input
                      type="range"
                      min={treeTimelineBounds.min}
                      max={treeTimelineBounds.max}
                      value={effectiveTreeTimelineYear ?? treeTimelineBounds.max}
                      style={{ "--tree-timeline-percent": `${treeTimelinePercent}%` } as CSSProperties}
                      onChange={(event) => setTreeTimelineYear(Number(event.target.value))}
                    />
                  </div>
                  <strong>{treeTimelineBounds.max}</strong>
                </div>
              ) : null}
              <div className="tree-zoom-controls" aria-label={t.treeZoom}>
              <button type="button" title={t.printTreePdf} aria-label={t.printTreePdf} onClick={printCurrentTreeToPdf}>
                <Printer size={17} />
              </button>
              <button
                className={treeTimelineEnabled ? "active" : ""}
                type="button"
                title={t.timeline}
                aria-label={t.timeline}
                onClick={() => {
                  setTreeTimelineEnabled((enabled) => !enabled);
                  setTreeTimelineYear((currentYear) => currentYear ?? treeTimelineBounds?.max ?? null);
                }}
              >
                <Hourglass size={17} />
              </button>
              <button
                className={displaySettings.showClinicalConditions ? "active" : ""}
                type="button"
                title={displaySettings.showClinicalConditions ? t.hideClinicalConditions : t.showClinicalConditionsInTree}
                aria-label={displaySettings.showClinicalConditions ? t.hideClinicalConditions : t.showClinicalConditionsInTree}
                onClick={() => updateDisplaySettings({ showClinicalConditions: !displaySettings.showClinicalConditions })}
              >
                <HeartPulse size={17} />
              </button>
              <button
                className={treeFlagBackgroundsEnabled ? "active" : ""}
                type="button"
                title="Banderas"
                aria-label="Banderas"
                onClick={() => setTreeFlagBackgroundsEnabled((enabled) => !enabled)}
              >
                <Flag size={17} />
              </button>
              <button type="button" title={t.fitTree} aria-label={t.fitTree} onClick={fitTreeToView}>
                <Maximize2 size={17} />
              </button>
              <button type="button" title={t.zoomOut} aria-label={t.zoomOut} onClick={() => updateTreeZoom(-0.1)}>
                <ZoomOut size={18} />
              </button>
              <span>{Math.round(treeZoom * 100)}%</span>
              <button type="button" title={t.zoomIn} aria-label={t.zoomIn} onClick={() => updateTreeZoom(0.1)}>
                <ZoomIn size={18} />
              </button>
              </div>
            </div>
          </div>
        </section>
      ) : activeView === "ancestors" ? (
        <AncestorsView t={t} onBack={showTreeView} />
      ) : activeView === "people" ? (
        <section className="people-view">
          <header className="people-view-header">
            <h1>{t.people}</h1>
            <div className="people-header-actions">
              <label className="search-box people-search">
                <Search size={17} />
                <input
                  value={query}
                  placeholder={t.searchPlaceholder}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button className="secondary-action compact-action" type="button" onClick={showTreeView}>
                <TreePine size={15} />
                <span>{t.treeMap}</span>
              </button>
            </div>
          </header>
          <div className="people-table" role="table" aria-label={t.people}>
            <div className="people-table-row people-table-head" role="row">
              <span role="columnheader">{t.person}</span>
              <span role="columnheader">{t.generationColumn}</span>
              <span role="columnheader">{t.birthDate}</span>
              <span role="columnheader">{t.birthPlace}</span>
              <span role="columnheader">{t.actions}</span>
            </div>
            {filteredPeople.map((person) => (
              <div className="people-table-row" role="row" key={person.id}>
                <div className="person-list-main">
                  <PersonCard
                    person={person}
                    selected={person.id === selectedId}
                    compact
                    lifeLabels={lifeLabels}
                    displaySettings={displaySettings}
                    clinicalConditions={project.clinicalConditions ?? []}
                    clinicalCategories={project.clinicalConditionCategories ?? []}
                    onSelect={selectPerson}
                  />
                </div>
                <span>{peopleGenerationLabels[person.id] ?? t.emptyValue}</span>
                <span>{person.birthDate || t.emptyValue}</span>
                <span>{getBirthAddress(person) || t.emptyValue}</span>
                <div className="row-actions">
                  <button type="button" title={t.editPerson} aria-label={t.editPerson} onClick={() => selectPerson(person)}>
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    title={t.deletePerson}
                    aria-label={t.deletePerson}
                    onClick={() => deletePerson(person)}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : activeView === "surnames" ? (
        <SurnamesView
          people={project.people}
          profiles={project.surnameProfiles ?? {}}
          selectedSurname={effectiveSelectedSurname}
          status={surnameStatus}
          t={t}
          onSelect={(surname) => {
            setSelectedSurname(surname);
            setSurnameStatus("");
          }}
          onUpdate={updateSurnameProfile}
          onFetchAllMeanings={fetchAllSurnameMeaningsData}
          onBack={showTreeView}
        />
      ) : activeView === "map" ? (
        <BirthMapView
          people={project.people}
          relationships={project.relationships}
          photos={project.galleryPhotos ?? []}
          selectedId={selectedId}
          t={t}
          showPhotos={displaySettings.showPhotos}
          onSelect={selectPerson}
        />
      ) : activeView === "calendar" ? (
        <BirthdayCalendarView
          people={project.people}
          relationships={project.relationships}
          photos={project.galleryPhotos ?? []}
          worldHistoryEvents={project.worldHistoryEvents ?? {}}
          selectedId={selectedId}
          t={t}
          showSaintDays={displaySettings.showSaintDays}
          onSelect={selectPerson}
          onOpenStarMap={selectPersonStarMap}
          onSaveWorldHistoryEvents={saveWorldHistoryEvents}
        />
      ) : activeView === "gallery" ? (
        <GalleryView
          people={project.people}
          photos={project.galleryPhotos ?? []}
          t={t}
          onAddFiles={addGalleryFiles}
          onUpdatePhoto={updateGalleryPhoto}
          onResolvePhotoLocation={resolveGalleryPhotoLocation}
          onResolveMissingPhotoLocations={resolveMissingGalleryPhotoLocations}
          onDeletePhoto={deleteGalleryPhoto}
          onSetPersonPhoto={setPersonPhotoFromGallery}
          initialPersonId={galleryInitialPersonId}
        />
      ) : activeView === "conditions" ? (
        <ConditionsCatalogView
          people={project.people}
          conditions={project.clinicalConditions ?? []}
          categories={project.clinicalConditionCategories ?? []}
          t={t}
          onSelectPerson={selectPerson}
          onUpdateCondition={updateClinicalCondition}
          onAddCategory={addClinicalConditionCategory}
          onUpdateCategory={updateClinicalConditionCategory}
          onDeleteCategory={deleteClinicalConditionCategory}
          onEnrichCondition={enrichClinicalConditionFromPublicSource}
        />
      ) : activeView === "customization" ? (
        <section className="customization-view">
          <header className="people-view-header settings-view-header">
            <h1>{t.customization}</h1>
            <div className="settings-tabs">
              <button
                className={settingsTab === "personalization" ? "active" : ""}
                type="button"
                onClick={() => setSettingsTab("personalization")}
              >
                <Palette size={15} />
                {t.personalizationTab}
              </button>
              <button
                className={settingsTab === "conditions" ? "active" : ""}
                type="button"
                onClick={() => setSettingsTab("conditions")}
              >
                <HeartPulse size={15} />
                {t.conditionsTab}
              </button>
            </div>
          </header>
          {settingsTab === "personalization" ? (
            <div className="settings-list">
              <label className="settings-field settings-field-inline">
                <span>
                  <strong>{t.language}</strong>
                </span>
                <LanguageSelect locale={locale} switchLocale={switchLocale} />
              </label>
              <section className="settings-field tree-style-field">
                <span>
                  <strong>{t.treeStyle}</strong>
                  <small>{t.treeStyleHint}</small>
                </span>
                <div className="tree-style-options">
                  {(["neutral", "medieval", "epic", "japanese"] as const).map((style) => (
                    <button
                      className={`tree-style-option tree-style-option-${style} ${
                        displaySettings.treeStyle === style ? "active" : ""
                      }`}
                      type="button"
                      key={style}
                      onClick={() => updateDisplaySettings({ treeStyle: style })}
                    >
                      <span className="tree-style-preview" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <strong>{t[`treeStyle_${style}`]}</strong>
                    </button>
                  ))}
                </div>
              </section>
              <label className="toggle-row">
                <span>
                  <strong>{t.darkMode}</strong>
                  <small>{t.darkModeHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.darkMode}
                  onChange={(event) => updateDisplaySettings({ darkMode: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.colorByGender}</strong>
                  <small>{t.colorByGenderHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.colorByGender}
                  onChange={(event) => updateDisplaySettings({ colorByGender: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.showPhotos}</strong>
                  <small>{t.showPhotosHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.showPhotos}
                  onChange={(event) => updateDisplaySettings({ showPhotos: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.showDeceasedSymbol}</strong>
                  <small>{t.showDeceasedSymbolHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.showDeceasedSymbol}
                  onChange={(event) => updateDisplaySettings({ showDeceasedSymbol: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.showGenerationLines}</strong>
                  <small>{t.showGenerationLinesHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.showGenerationLines}
                  onChange={(event) => updateDisplaySettings({ showGenerationLines: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.showSaintDays}</strong>
                  <small>{t.showSaintDaysHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.showSaintDays}
                  onChange={(event) => updateDisplaySettings({ showSaintDays: event.target.checked })}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t.showClinicalConditions}</strong>
                  <small>{t.showClinicalConditionsHint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={displaySettings.showClinicalConditions}
                  onChange={(event) => updateDisplaySettings({ showClinicalConditions: event.target.checked })}
                />
              </label>
              <label className="settings-field">
                <span>
                  <strong>{t.requestMessageTitle}</strong>
                  <small>{t.requestMessageHint}</small>
                </span>
                <textarea
                  value={contributionRequestMessage}
                  onChange={(event) => updateContributionRequestMessage(event.target.value)}
                />
              </label>
              {serverMode && serverRole === "admin" ? (
                <ServerAccessSettingsPanel
                  settings={serverSettings}
                  onSaveSettings={async (settings) => {
                    const nextSettings = await updateServerSettings(settings);
                    setServerSettings(nextSettings);
                  }}
                  onSavePasswords={updateServerPasswords}
                />
              ) : null}
            </div>
          ) : (
            <ConditionsCatalogView
              people={project.people}
              conditions={project.clinicalConditions ?? []}
              categories={project.clinicalConditionCategories ?? []}
              t={t}
              onSelectPerson={selectPerson}
              onUpdateCondition={updateClinicalCondition}
              onAddCategory={addClinicalConditionCategory}
              onUpdateCategory={updateClinicalConditionCategory}
              onDeleteCategory={deleteClinicalConditionCategory}
              onEnrichCondition={enrichClinicalConditionFromPublicSource}
              embedded
            />
          )}
        </section>
      ) : (
        <section className="contributions-view">
          <header className="people-view-header">
            <h1>{t.contributionInbox}</h1>
            <div className="view-actions">
              <button type="button" onClick={() => contributionInputRef.current?.click()}>
                <Upload size={17} />
                <span>{t.importContribution}</span>
              </button>
              <input
                ref={contributionInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importContributionFile(file);
                }}
              />
            </div>
          </header>
          <div className="contribution-list">
            {pendingProjectChanges.map((change) => (
              <section className="contribution-card" key={change.id}>
                <header>
                  <div>
                    <span className="status-pill status-pending">Pendiente</span>
                    <h2>Cambio enviado por invitado</h2>
                    <p>{formatPendingProjectChangeSummary(change)}</p>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      title={t.acceptContribution}
                      aria-label={t.acceptContribution}
                      onClick={async () => {
                        const result = await acceptPendingProjectChange(change.id);
                        setPendingProjectChanges(result.pendingProjectChanges);
                        setProject(result.project);
                        setSelectedId(result.project?.people[0]?.id ?? "");
                      }}
                    >
                      <Check size={17} />
                    </button>
                    <button
                      type="button"
                      title={t.rejectContribution}
                      aria-label={t.rejectContribution}
                      onClick={async () => {
                        const result = await rejectPendingProjectChange(change.id);
                        setPendingProjectChanges(result.pendingProjectChanges);
                        if (result.project) setProject(result.project);
                      }}
                    >
                      <X size={17} />
                    </button>
                  </div>
                </header>
                <p className="contribution-comment">
                  Recibido el {new Date(change.createdAt).toLocaleString("es-ES")}. Al aceptar se aplicará la versión propuesta
                  del árbol.
                </p>
              </section>
            ))}
            {pendingContributions.length === 0 && pendingProjectChanges.length === 0 ? (
              <section className="empty-state">
                <Inbox size={34} />
                <h2>{t.noContributions}</h2>
                <p>{t.noContributionsHint}</p>
              </section>
            ) : (
              pendingContributions.map((contribution) => {
                const targetPerson = project.people.find((person) => person.id === contribution.targetPersonId);

                return (
                  <section className="contribution-card" key={contribution.id}>
                    <header>
                      <div>
                        <span className={`status-pill status-${contribution.status}`}>
                          {t[`status_${contribution.status}`]}
                        </span>
                        <h2>{targetPerson ? fullName(targetPerson) : t.person}</h2>
                        <p>
                          {[contribution.contributorName, contribution.contributorEmail].filter(Boolean).join(" · ") ||
                            t.unknownContributor}
                        </p>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          title={t.acceptContribution}
                          aria-label={t.acceptContribution}
                          disabled={contribution.status !== "pending"}
                          onClick={() => acceptContribution(contribution)}
                        >
                          <Check size={17} />
                        </button>
                        <button
                          type="button"
                          title={t.rejectContribution}
                          aria-label={t.rejectContribution}
                          disabled={contribution.status !== "pending"}
                          onClick={() => rejectContribution(contribution)}
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </header>
                    {contribution.source ? <ContributionSource source={contribution.source} t={t} /> : null}
                    {contribution.comment ? <p className="contribution-comment">{contribution.comment}</p> : null}
                    {targetPerson ? (
                      <ContributionDiffTable
                        title={t.person}
                        person={targetPerson}
                        patch={contribution.personPatch}
                        contribution={contribution}
                        t={t}
                        onAcceptField={acceptContributionField}
                        onRejectField={rejectContributionField}
                      />
                    ) : null}
                    {contribution.relatedPatches?.map((relatedPatch) => {
                      const relatedPerson = project.people.find((person) => person.id === relatedPatch.targetPersonId);
                      if (!relatedPerson) return null;

                      return (
                        <ContributionDiffTable
                          key={relatedPatch.targetPersonId}
                          title={`${relatedPatch.relationshipLabel}: ${fullName(relatedPerson)}`}
                          person={relatedPerson}
                          patch={relatedPatch.personPatch}
                          contribution={contribution}
                          t={t}
                          onAcceptField={acceptContributionField}
                          onRejectField={rejectContributionField}
                        />
                      );
                    })}
                  </section>
                );
              })
            )}
          </div>
        </section>
      )}

      {personModalOpen && selectedPerson ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPersonModalOpen(false)}>
          <section
            className="person-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {(() => {
              const selectedZodiacSign = getZodiacSignInfo(selectedPerson.birthDate, t);
              return (
                <>
            <header className="modal-header">
              <div className="person-modal-title-block">
                <span
                  className="portrait modal-portrait"
                  style={{ backgroundImage: selectedPerson.photoUrl ? `url(${selectedPerson.photoUrl})` : undefined }}
                >
                  {!selectedPerson.photoUrl ? selectedPerson.givenName.slice(0, 1) : null}
                </span>
                <div>
                  <h2 id="person-modal-title" className="person-modal-name">
                    {selectedPerson.givenName.trim() ? (
                      <button className="person-name-token given-name-token" type="button" onClick={() => openGivenNameDetail(selectedPerson.givenName)}>
                        {selectedPerson.givenName}
                      </button>
                    ) : null}
                    {extractSurnames(selectedPerson.familyName).map((surname) => (
                      <button className="person-name-token surname-token" type="button" key={surname} onClick={() => openSurnameDetail(surname)}>
                        {surname}
                      </button>
                    ))}
                    {!fullName(selectedPerson) ? <span className="person-name-token">{t.person}</span> : null}
                  </h2>
                  <p className="profile-life-line">
                    <span>{getLifeStatus(selectedPerson, lifeLabels)}</span>
                    <span
                      className={`gender-symbol-badge gender-symbol-${selectedPerson.gender}`}
                      title={formatGender(selectedPerson.gender, t)}
                      aria-label={formatGender(selectedPerson.gender, t)}
                    >
                      <span>{getGenderSymbol(selectedPerson.gender)}</span>
                    </span>
                    {selectedZodiacSign ? (
                      <button
                        className="zodiac-badge"
                        type="button"
                        onClick={() => setZodiacModalSign(selectedZodiacSign)}
                      >
                        <span className="zodiac-badge-symbol" aria-hidden="true">
                          {selectedZodiacSign.symbol}
                        </span>
                        <span>{selectedZodiacSign.label}</span>
                      </button>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="modal-header-actions">
                {!personModalEditing ? (
                  <>
                    <button type="button" title={t.editPerson} aria-label={t.editPerson} onClick={() => setPersonModalEditing(true)}>
                      <Pencil size={16} />
                    </button>
                    <button type="button" title={t.requestInfo} aria-label={t.requestInfo} onClick={() => requestPersonInfo(selectedPerson)}>
                      <Mail size={16} />
                    </button>
                  </>
                ) : null}
                <button type="button" title={t.close} aria-label={t.close} onClick={() => setPersonModalOpen(false)}>
                  <X size={17} />
                </button>
              </div>
            </header>
            {personModalEditing ? (
              <PersonEditor
                person={selectedPerson}
                t={t}
                onChange={updateSelectedPerson}
                onSave={() => {
                  setPersonModalEditing(false);
                  setPersonProfileTab("details");
                }}
                onRequestInfo={() => requestPersonInfo(selectedPerson)}
              />
            ) : (
              <PersonProfile
                person={selectedPerson}
                people={project.people}
                relationships={project.relationships}
                clinicalConditions={project.clinicalConditions ?? []}
                galleryPhotos={project.galleryPhotos ?? []}
                famousBirths={project.famousBirths ?? {}}
                activeTab={personProfileTab}
                lifeLabels={lifeLabels}
                t={t}
                onTabChange={setPersonProfileTab}
                onEdit={() => setPersonModalEditing(true)}
                onOpenSurname={openSurnameDetail}
                onOpenGivenName={openGivenNameDetail}
                onLinkClinicalCondition={linkClinicalConditionToSelectedPerson}
                onUnlinkClinicalCondition={unlinkClinicalConditionFromSelectedPerson}
                onUpdateClinicalCondition={updateClinicalCondition}
                onEnrichClinicalCondition={enrichClinicalConditionFromPublicSource}
                onOpenConditionCatalog={openConditionCatalog}
                onAddPublicInfoLink={addPublicInfoLinkToSelectedPerson}
                onUpdatePublicInfoLink={updateSelectedPersonPublicLink}
                onRejectPublicInfoLink={removeSelectedPersonPublicLink}
                onUpdateRelationshipStartDate={updateRelationshipStartDate}
                onSetPersonPhotoFromGallery={setPersonPhotoFromGallery}
                onOpenPersonGallery={openPersonGallery}
                onSaveFamousBirth={saveFamousBirth}
              />
            )}
                </>
              );
            })()}
          </section>
        </div>
      ) : null}

      {zodiacModalSign ? (
        <ZodiacInfoModal sign={zodiacModalSign} t={t} onClose={() => setZodiacModalSign(null)} />
      ) : null}

      {pendingGalleryUpload.length > 0 ? (
        <GalleryUploadLocationModal
          photos={pendingGalleryUpload}
          t={t}
          onUpdatePhoto={updatePendingGalleryPhoto}
          onCancel={cancelPendingGalleryUpload}
          onConfirm={confirmPendingGalleryUpload}
        />
      ) : null}

      {selectedGivenName ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedGivenName("")}>
          <section
            className="person-modal name-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="name-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <div>
                <span className="eyebrow">{t.givenNameMeaning}</span>
                <h2 id="name-modal-title">{selectedGivenName}</h2>
              </div>
              <button type="button" title={t.close} aria-label={t.close} onClick={() => setSelectedGivenName("")}>
                <X size={20} />
              </button>
            </header>
            <GivenNameMeaningPanel
              name={selectedGivenName}
              profile={selectedNameProfile}
              status={nameStatus}
              t={t}
            />
          </section>
        </div>
      ) : null}

    </main>
  );
}

function AncestorsView({ t, onBack }: { t: Record<string, string>; onBack: () => void }) {
  return (
    <section className="ancestors-view">
      <header className="people-view-header">
        <h1>{t.ancestors}</h1>
        <button className="secondary-action compact-action" type="button" onClick={onBack}>
          <TreePine size={17} />
          <span>{t.treeMap}</span>
        </button>
      </header>
      <div className="ancestor-source-grid">
        <a
          className="ancestor-source-card"
          href="https://sede.mjusticia.gob.es/es/tramites/certificado-nacimiento"
          target="_blank"
          rel="noreferrer"
        >
          <div>
            <span className="eyebrow">{t.officialSource}</span>
            <h2>{t.literalBirthCertificate}</h2>
          </div>
          <div className="ancestor-source-badges" aria-hidden="true">
            <span>{t.free}</span>
            <span>{t.online}</span>
          </div>
          <p>{t.literalBirthCertificateDescription}</p>
          <span className="source-card-link">
            <SquareArrowOutUpRight size={17} />
            {t.openExternalSource}
          </span>
        </a>
      </div>
    </section>
  );
}

function getPartnerRelationshipsForPerson(personId: string, people: Person[], relationships: Relationship[]) {
  return relationships
    .filter(
      (relationship) =>
        ["partner", "spouse", "former_spouse"].includes(relationship.kind) &&
        (relationship.fromPersonId === personId || relationship.toPersonId === personId)
    )
    .map((relationship) => {
      const partnerId = relationship.fromPersonId === personId ? relationship.toPersonId : relationship.fromPersonId;
      const partner = people.find((person) => person.id === partnerId);
      return partner ? { relationship, partner } : null;
    })
    .filter((entry): entry is { relationship: Relationship; partner: Person } => Boolean(entry))
    .sort((first, second) => fullName(first.partner).localeCompare(fullName(second.partner), "es"));
}

function extractYear(value?: string) {
  const match = value?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : null;
}

function getTreeTimelineBounds(people: Person[]) {
  const years = people
    .map((person) => extractYear(person.birthDate))
    .filter((year): year is number => year !== null)
    .sort((first, second) => first - second);

  if (years.length === 0) return null;
  return { min: years[0], max: Math.max(new Date().getFullYear(), years[years.length - 1]) };
}

function filterPeopleByTimeline(people: Person[], year: number) {
  return people.filter((person) => {
    const birthYear = extractYear(person.birthDate);
    return birthYear !== null && birthYear <= year;
  });
}

function getVisiblePartnerRelationshipKeys(relationships: Relationship[], people: Person[], year: number) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const visibleKeys = new Set<string>();

  relationships
    .filter((relationship) => ["partner", "spouse", "former_spouse"].includes(relationship.kind))
    .forEach((relationship) => {
      const relationshipYear = getRelationshipTimelineYear(relationship, peopleById);
      if (relationshipYear !== null && relationshipYear <= year) {
        visibleKeys.add(getTimelineRelationshipKey(relationship.fromPersonId, relationship.toPersonId));
      }
    });

  const parentRelationships = relationships.filter((relationship) => relationship.kind === "parent_child");
  const childIds = Array.from(new Set(parentRelationships.map((relationship) => relationship.toPersonId)));
  childIds.forEach((childId) => {
    const parentIds = parentRelationships
      .filter((relationship) => relationship.toPersonId === childId)
      .map((relationship) => relationship.fromPersonId);
    if (parentIds.length < 2) return;

    const childBirthYear = extractYear(peopleById.get(childId)?.birthDate);
    if (childBirthYear === null || childBirthYear > year) return;

    for (let firstIndex = 0; firstIndex < parentIds.length - 1; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < parentIds.length; secondIndex += 1) {
        visibleKeys.add(getTimelineRelationshipKey(parentIds[firstIndex], parentIds[secondIndex]));
      }
    }
  });

  return visibleKeys;
}

function getRelationshipTimelineYear(relationship: Relationship, peopleById: Map<string, Person>) {
  const explicitYear = extractYear(relationship.startDate);
  if (explicitYear !== null) return explicitYear;

  const fromBirthYear = extractYear(peopleById.get(relationship.fromPersonId)?.birthDate);
  const toBirthYear = extractYear(peopleById.get(relationship.toPersonId)?.birthDate);
  if (fromBirthYear === null || toBirthYear === null) return null;
  return Math.max(fromBirthYear, toBirthYear);
}

function getTimelineRelationshipKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join("::");
}

function DraftFields({
  draft,
  setDraft,
  t
}: {
  draft: PersonDraft;
  setDraft: (draft: PersonDraft) => void;
  t: Record<string, string>;
}) {
  return (
    <>
      <label>
        <span>{t.givenName}</span>
        <input
          value={draft.givenName}
          onChange={(event) => setDraft({ ...draft, givenName: event.target.value })}
        />
      </label>
      <label>
        <span>{t.familyName}</span>
        <input value={draft.familyName} onChange={(event) => setDraft({ ...draft, familyName: event.target.value })} />
      </label>
      <label>
        <span>{t.birthDate}</span>
        <input
          value={draft.birthDate}
          placeholder="DD/MM/AAAA"
          onChange={(event) => setDraft({ ...draft, birthDate: event.target.value })}
        />
      </label>
      <label>
        <span>{t.birthCity}</span>
        <input value={draft.birthCity} onChange={(event) => setDraft({ ...draft, birthCity: event.target.value })} />
      </label>
      <label>
        <span>{t.birthCountry}</span>
        <input
          value={draft.birthCountry}
          onChange={(event) => setDraft({ ...draft, birthCountry: event.target.value })}
        />
      </label>
    </>
  );
}

function LoginScreen({
  authError,
  onLogin
}: {
  authError: string;
  onLogin: (role: ServerRole, password: string) => Promise<void>;
}) {
  const [role, setRole] = useState<ServerRole>("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className="wizard-screen">
      <section className="wizard-shell login-shell">
        <div className="wizard-brand">
          <img className="brand-logo" src="/opentree-logo.png" alt="OpenTree" />
        </div>
        <div className="wizard-copy">
          <span className="eyebrow">OpenTree</span>
          <h2>Acceso privado</h2>
          <p>Inicia sesión como administrador o invitado para consultar y aportar información al árbol.</p>
        </div>
        <form
          className="wizard-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setLoading(true);
            try {
              await onLogin(role, password);
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>
            <span>Perfil</span>
            <select value={role} onChange={(event) => setRole(event.target.value as ServerRole)}>
              <option value="admin">Admin</option>
              <option value="guest">Invitado</option>
            </select>
          </label>
          <label>
            <span>Contraseña</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {authError ? <p className="form-error">{authError}</p> : null}
          <button className="primary-action" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ServerAccessSettingsPanel({
  settings,
  onSaveSettings,
  onSavePasswords
}: {
  settings: ServerSettings;
  onSaveSettings: (settings: Partial<ServerSettings>) => Promise<void>;
  onSavePasswords: (passwords: Partial<Record<ServerRole, string>>) => Promise<void>;
}) {
  const [guestPhotoLimit, setGuestPhotoLimit] = useState(String(settings.guestPhotoLimit));
  const [adminPassword, setAdminPassword] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setGuestPhotoLimit(String(settings.guestPhotoLimit));
  }, [settings.guestPhotoLimit]);

  return (
    <section className="settings-field server-access-settings">
      <span>
        <strong>Acceso web</strong>
        <small>Configura los perfiles admin e invitado del contenedor OpenTree.</small>
      </span>
      <div className="server-access-grid">
        <label>
          <span>Límite de fotos del invitado</span>
          <input
            type="number"
            min={0}
            value={guestPhotoLimit}
            onChange={(event) => setGuestPhotoLimit(event.target.value)}
          />
        </label>
        <button
          className="secondary-action compact-action"
          type="button"
          onClick={async () => {
            await onSaveSettings({ guestPhotoLimit: Number(guestPhotoLimit) });
            setStatus("Ajustes de acceso guardados.");
          }}
        >
          <Check size={15} />
          <span>Guardar límite</span>
        </button>
        <label>
          <span>Nueva contraseña admin</span>
          <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} />
        </label>
        <label>
          <span>Nueva contraseña invitado</span>
          <input type="password" value={guestPassword} onChange={(event) => setGuestPassword(event.target.value)} />
        </label>
        <button
          className="secondary-action compact-action"
          type="button"
          onClick={async () => {
            await onSavePasswords({
              ...(adminPassword.trim() ? { admin: adminPassword } : {}),
              ...(guestPassword.trim() ? { guest: guestPassword } : {})
            });
            setAdminPassword("");
            setGuestPassword("");
            setStatus("Contraseñas actualizadas.");
          }}
        >
          <Check size={15} />
          <span>Guardar contraseñas</span>
        </button>
      </div>
      {status ? <small>{status}</small> : null}
    </section>
  );
}

function formatPendingProjectChangeSummary(change: PendingProjectChange) {
  const parts = [
    change.summary.addedPeople ? `${change.summary.addedPeople} persona(s) nueva(s)` : "",
    change.summary.editedPeople ? `${change.summary.editedPeople} persona(s) editada(s)` : "",
    change.summary.relationshipDelta ? `${change.summary.relationshipDelta} relación(es) nueva(s)` : "",
    change.summary.addedPhotos ? `${change.summary.addedPhotos} foto(s) nueva(s)` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Cambio pendiente de revisión";
}

function PersonProfile({
  person,
  people,
  relationships,
  clinicalConditions,
  galleryPhotos,
  famousBirths,
  activeTab,
  lifeLabels,
  t,
  onTabChange,
  onEdit,
  onOpenSurname,
  onOpenGivenName,
  onLinkClinicalCondition,
  onUnlinkClinicalCondition,
  onUpdateClinicalCondition,
  onEnrichClinicalCondition,
  onOpenConditionCatalog,
  onAddPublicInfoLink,
  onUpdatePublicInfoLink,
  onRejectPublicInfoLink,
  onUpdateRelationshipStartDate,
  onSetPersonPhotoFromGallery,
  onOpenPersonGallery,
  onSaveFamousBirth
}: {
  person: Person;
  people: Person[];
  relationships: Relationship[];
  clinicalConditions: ClinicalCondition[];
  galleryPhotos: GalleryPhoto[];
  famousBirths: Record<string, FamousBirthMatch | null>;
  activeTab: PersonProfileTab;
  lifeLabels: LifeLabels;
  t: Record<string, string>;
  onTabChange: (tab: PersonProfileTab) => void;
  onEdit: () => void;
  onOpenSurname: (surname: string) => void;
  onOpenGivenName: (name: string) => void;
  onLinkClinicalCondition: (conditionName: string) => void;
  onUnlinkClinicalCondition: (conditionId: string) => void;
  onUpdateClinicalCondition: (conditionId: string, patch: Partial<ClinicalCondition>) => void;
  onEnrichClinicalCondition: (conditionId: string) => Promise<void>;
  onOpenConditionCatalog: () => void;
  onAddPublicInfoLink: (
    link: Pick<PublicInfoLink, "title" | "url" | "snippet" | "imageUrl"> & { status?: PublicInfoLink["status"] }
  ) => void;
  onUpdatePublicInfoLink: (linkId: string, patch: Partial<PublicInfoLink>) => void;
  onRejectPublicInfoLink: (linkId: string) => void;
  onUpdateRelationshipStartDate: (relationshipId: string, startDate: string) => void;
  onSetPersonPhotoFromGallery: (photo: GalleryPhoto, personId: string) => void;
  onOpenPersonGallery: (person: Person) => void;
  onSaveFamousBirth: (cacheKey: string, match: FamousBirthMatch | null) => void;
}) {
  const birthPlace = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const isDeceased = person.isDeceased ?? Boolean(person.deathDate);
  const birthCommunity = getKnownAutonomousCommunityForPerson(person);
  const showBirthCommunityWarning = shouldCheckAutonomousCommunity(person) && !birthCommunity;
  const partnerRelationships = getPartnerRelationshipsForPerson(person.id, people, relationships);
  const linkedGalleryPhotos = galleryPhotos
    .filter((photo) => photo.personIds.includes(person.id))
    .sort(compareGalleryPhotos)
    .slice(0, 3);

  return (
    <div className="profile-readonly">
      <div className="profile-tabs" role="tablist" aria-label={t.details}>
        <button
          className={activeTab === "details" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("details")}
        >
          <Users size={14} />
          <span>{t.personalData}</span>
        </button>
        <button
          className={activeTab === "clinical" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("clinical")}
        >
          <HeartPulse size={14} />
          <span>{t.clinicalProfile}</span>
        </button>
        <button
          className={activeTab === "public" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("public")}
        >
          <Search size={14} />
          <span>{t.publicInfo}</span>
        </button>
        <button
          className={activeTab === "stars" ? "active" : ""}
          type="button"
          onClick={() => onTabChange("stars")}
        >
          <Star size={14} />
          <span>{t.starMap}</span>
        </button>
      </div>
      {activeTab === "details" ? (
        <>
          <div className="profile-fields">
            <BirthSummaryField
              person={person}
              birthPlace={birthPlace}
              label={t.birth}
              fallback={t.emptyValue}
              warning={showBirthCommunityWarning ? t.unrecognizedRegionHint : undefined}
              cachedFamousBirth={birthDateCacheValue(person.birthDate, famousBirths)}
              onSaveFamousBirth={onSaveFamousBirth}
              t={t}
            />
            {isDeceased ? (
              <ReadOnlyField label={t.deathDate} value={person.deathDate} fallback={t.emptyValue} />
            ) : null}
          </div>
          {partnerRelationships.length > 0 ? (
            <section className="relationship-date-panel">
              <strong>{t.relationships}</strong>
              <div className="relationship-date-list">
                {partnerRelationships.map(({ relationship, partner }) => (
                  <label key={relationship.id}>
                    <span>{fullName(partner) || t.person}</span>
                    <input
                      value={relationship.startDate ?? ""}
                      placeholder="DD/MM/AAAA"
                      onChange={(event) => onUpdateRelationshipStartDate(relationship.id, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}
          {linkedGalleryPhotos.length > 0 ? (
            <section className="profile-gallery-panel">
              <div className="profile-gallery-heading">
                <strong>{t.personGalleryPhotos}</strong>
                <button type="button" title={t.gallery} aria-label={t.gallery} onClick={() => onOpenPersonGallery(person)}>
                  <Image size={16} />
                </button>
              </div>
              <div className="profile-gallery-list">
                {linkedGalleryPhotos.map((photo) => (
                  <button type="button" key={photo.id} onClick={() => onSetPersonPhotoFromGallery(photo, person.id)}>
                    <span className="profile-gallery-thumb" style={{ backgroundImage: `url(${photo.dataUrl})` }}>
                      <span>{t.useAsProfilePhoto}</span>
                    </span>
                    <span>{photo.title || photo.fileName || t.galleryPhoto}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : activeTab === "clinical" ? (
        <ClinicalProfilePanel
          person={person}
          people={people}
          clinicalConditions={clinicalConditions}
          t={t}
          onLinkClinicalCondition={onLinkClinicalCondition}
          onUnlinkClinicalCondition={onUnlinkClinicalCondition}
          onUpdateClinicalCondition={onUpdateClinicalCondition}
          onEnrichClinicalCondition={onEnrichClinicalCondition}
          onOpenConditionCatalog={onOpenConditionCatalog}
        />
      ) : activeTab === "public" ? (
        <PublicInfoPanel
          person={person}
          t={t}
          onAddPublicInfoLink={onAddPublicInfoLink}
          onUpdatePublicInfoLink={onUpdatePublicInfoLink}
          onRejectPublicInfoLink={onRejectPublicInfoLink}
        />
      ) : (
        <StarMapPanel person={person} t={t} onEdit={onEdit} />
      )}
    </div>
  );
}

function ZodiacInfoModal({
  sign,
  t,
  onClose
}: {
  sign: ZodiacSignInfo;
  t: Record<string, string>;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState(t.publicInfoSearching);
  const traits = getZodiacPersonalityTextClean(sign.key);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setStatus(t.publicInfoSearching);
      setSummary("");
      try {
        const response = await fetch(
          `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(sign.pageTitle)}`
        );
        if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
        const data = (await response.json()) as { extract?: string };
        if (cancelled) return;
        setSummary(data.extract?.trim() || "");
        setStatus(data.extract ? "" : t.publicInfoNoSearchResults);
      } catch {
        if (!cancelled) setStatus(t.publicInfoSearchError);
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [sign.pageTitle, t]);

  return (
    <div className="modal-backdrop zodiac-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="zodiac-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t.zodiacTraits}</span>
            <h2>
              {sign.symbol} {sign.label}
            </h2>
          </div>
          <button type="button" title={t.close} aria-label={t.close} onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="zodiac-content">
          <div className="zodiac-traits">
            <p>{traits}</p>
          </div>
          {summary ? <p>{summary}</p> : <p>{status}</p>}
        </div>
        <footer className="zodiac-source">
          <a href={sign.sourceUrl} target="_blank" rel="noreferrer">
            <SquareArrowOutUpRight size={15} />
            <span>{t.wikipediaSource}</span>
          </a>
          <a href={ZODIAC_TRAITS_SOURCE_URL} target="_blank" rel="noreferrer">
            <SquareArrowOutUpRight size={15} />
            <span>Fuente: ABC</span>
          </a>
        </footer>
      </section>
    </div>
  );
}

function ClinicalProfilePanel({
  person,
  people,
  clinicalConditions,
  t,
  onLinkClinicalCondition,
  onUnlinkClinicalCondition,
  onOpenConditionCatalog
}: {
  person: Person;
  people: Person[];
  clinicalConditions: ClinicalCondition[];
  t: Record<string, string>;
  onLinkClinicalCondition: (conditionName: string) => void;
  onUnlinkClinicalCondition: (conditionId: string) => void;
  onUpdateClinicalCondition: (conditionId: string, patch: Partial<ClinicalCondition>) => void;
  onEnrichClinicalCondition: (conditionId: string) => Promise<void>;
  onOpenConditionCatalog: () => void;
}) {
  const [query, setQuery] = useState("");
  const linkedConditionIds = person.clinicalConditionIds ?? [];
  const linkedConditions = linkedConditionIds
    .map((conditionId) => clinicalConditions.find((condition) => condition.id === conditionId))
    .filter((condition): condition is ClinicalCondition => Boolean(condition))
    .sort(compareClinicalConditions);
  const normalizedQuery = normalizeClinicalConditionName(query);
  const availableConditions = clinicalConditions
    .filter((condition) => !linkedConditionIds.includes(condition.id))
    .filter((condition) => !normalizedQuery || normalizeClinicalConditionName(condition.name).includes(normalizedQuery))
    .slice(0, 6);
  const exactMatch = clinicalConditions.some(
    (condition) => normalizeClinicalConditionName(condition.name) === normalizedQuery
  );
  const canCreate = Boolean(query.trim()) && !exactMatch;

  function linkCondition(name: string) {
    onLinkClinicalCondition(name);
    setQuery("");
  }

  return (
    <div className="clinical-profile">
      <section className="clinical-linked-card">
        <strong>{t.linkedClinicalConditions}</strong>
        {linkedConditions.length === 0 ? (
          <p>{t.noClinicalConditions}</p>
        ) : (
          <div className="clinical-condition-list">
            {linkedConditions.map((condition) => {
              const affectedPeople = getAffectedPeople(people, condition.id);
              return (
                <article key={condition.id} className="clinical-condition-card clinical-condition-card-minimal">
                  <div>
                    <button className="condition-title-link" type="button" onClick={onOpenConditionCatalog}>
                      {condition.name}
                    </button>
                    <p>{t.affectedPeopleCount.replace("{count}", String(affectedPeople.length))}</p>
                  </div>
                  <button type="button" title={t.unlinkClinicalCondition} onClick={() => onUnlinkClinicalCondition(condition.id)}>
                    <X size={16} />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="clinical-search-card">
        <div>
          <strong>{t.linkClinicalCondition}</strong>
          <p>{t.clinicalProfileHint}</p>
        </div>
        <label className="search-box clinical-search">
          <Search size={17} />
          <input
            value={query}
            placeholder={t.clinicalConditionSearchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {availableConditions.length > 0 || canCreate ? (
          <div className="clinical-suggestions">
            {availableConditions.map((condition) => (
              <button type="button" key={condition.id} onClick={() => linkCondition(condition.name)}>
                <HeartPulse size={15} />
                <span>{condition.name}</span>
                <small>{t.affectedPeopleCount.replace("{count}", String(getAffectedPeople(people, condition.id).length))}</small>
              </button>
            ))}
            {canCreate ? (
              <button className="create-condition" type="button" onClick={() => linkCondition(query)}>
                <HeartPulse size={15} />
                <span>{t.createClinicalCondition.replace("{name}", query.trim())}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PublicInfoPanel({
  person,
  t,
  onAddPublicInfoLink,
  onUpdatePublicInfoLink,
  onRejectPublicInfoLink
}: {
  person: Person;
  t: Record<string, string>;
  onAddPublicInfoLink: (
    link: Pick<PublicInfoLink, "title" | "url" | "snippet" | "imageUrl"> & { status?: PublicInfoLink["status"] }
  ) => void;
  onUpdatePublicInfoLink: (linkId: string, patch: Partial<PublicInfoLink>) => void;
  onRejectPublicInfoLink: (linkId: string) => void;
}) {
  const [draftUrl, setDraftUrl] = useState("");
  const [editingLinkId, setEditingLinkId] = useState("");
  const [editingDraft, setEditingDraft] = useState({ title: "", url: "", snippet: "", imageUrl: "" });
  const [searchResults, setSearchResults] = useState<Array<PublicInfoPreview>>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const publicInfoLinks = person.publicInfoLinks ?? [];

  async function addLink() {
    const normalizedUrl = normalizeInputUrl(draftUrl);
    if (!normalizedUrl) return;

    setDraftLoading(true);
    try {
      const metadata = await enrichPublicInfoPreview({ title: "", url: normalizedUrl, snippet: "" });
      onAddPublicInfoLink({ ...metadata, status: "accepted" });
      setDraftUrl("");
    } finally {
      setDraftLoading(false);
    }
  }

  function startEditingLink(link: PublicInfoLink) {
    setEditingLinkId(link.id);
    setEditingDraft({
      title: link.title ?? "",
      url: link.url ?? "",
      snippet: link.snippet ?? "",
      imageUrl: link.imageUrl ?? ""
    });
  }

  function saveEditingLink() {
    if (!editingLinkId || !editingDraft.url.trim()) return;
    onUpdatePublicInfoLink(editingLinkId, {
      title: editingDraft.title.trim(),
      url: editingDraft.url.trim(),
      snippet: editingDraft.snippet.trim(),
      imageUrl: editingDraft.imageUrl.trim()
    });
    setEditingLinkId("");
    setEditingDraft({ title: "", url: "", snippet: "", imageUrl: "" });
  }

  async function searchPublicInfo() {
    setSearchLoading(true);
    setSearchStatus(t.publicInfoSearching);
    try {
      const html = await fetchPublicSearchHtml(`"${fullName(person)}"`);
      const results = parsePublicSearchResults(html);
      const enrichedResults = await Promise.all(results.map(enrichPublicInfoPreview));
      setSearchResults(enrichedResults);
      setSearchStatus(enrichedResults.length > 0 ? "" : t.publicInfoNoSearchResults);
    } catch (error) {
      console.error(error);
      setSearchResults([]);
      setSearchStatus(t.publicInfoSearchError);
    } finally {
      setSearchLoading(false);
    }
  }

  return (
    <div className="public-info-panel">
      <section className="public-link-list">
        <strong>{t.hemeroteca}</strong>
        {publicInfoLinks.length === 0 ? (
          <p>{t.noPublicResults}</p>
        ) : (
          publicInfoLinks.map((link) => {
            const isEditing = editingLinkId === link.id;

            return (
              <article key={link.id} className={`public-link-card status-${link.status}`}>
                {isEditing ? (
                  <div className="public-link-edit-fields">
                    <label>
                      <span>{t.sourceTitle}</span>
                      <input
                        value={editingDraft.title}
                        onChange={(event) => setEditingDraft({ ...editingDraft, title: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t.sourceUrl}</span>
                      <input
                        value={editingDraft.url}
                        onChange={(event) => setEditingDraft({ ...editingDraft, url: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t.publicResultSnippet}</span>
                      <textarea
                        value={editingDraft.snippet}
                        onChange={(event) => setEditingDraft({ ...editingDraft, snippet: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t.imageUrl}</span>
                      <input
                        value={editingDraft.imageUrl}
                        onChange={(event) => setEditingDraft({ ...editingDraft, imageUrl: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <PublicInfoPreviewCard link={link} t={t} />
                )}
                <div>
                  {isEditing ? (
                    <>
                      <button type="button" title={t.save} onClick={saveEditingLink} disabled={!editingDraft.url.trim()}>
                        <Check size={16} />
                      </button>
                      <button type="button" title={t.close} onClick={() => setEditingLinkId("")}>
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" title={t.editPerson} onClick={() => startEditingLink(link)}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" title={t.rejectContribution} onClick={() => onRejectPublicInfoLink(link.id)}>
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
      <section className="public-search-card">
        <div className="public-search-header">
          <div>
            <strong>{t.publicInfoSearch}</strong>
            <p>{t.publicInfoHint}</p>
          </div>
          <button className="primary-action compact-action" type="button" onClick={searchPublicInfo} disabled={searchLoading}>
            <Search size={17} />
            <span>{searchLoading ? t.publicInfoSearching : t.search}</span>
          </button>
        </div>
        {searchStatus ? <small>{searchStatus}</small> : null}
        {searchResults.length > 0 ? (
          <div className="public-search-results">
            {searchResults.map((result) => (
              <PublicInfoPreviewCard
                key={result.url}
                link={result}
                t={t}
                action={
                  <button
                    type="button"
                    title={t.save}
                    onClick={() => onAddPublicInfoLink({ ...result, status: "accepted" })}
                    disabled={publicInfoLinks.some((link) => normalizeUrl(link.url) === normalizeUrl(result.url))}
                  >
                    <Check size={16} />
                  </button>
                }
              />
            ))}
          </div>
        ) : null}
      </section>
      <section className="public-link-form">
        <div>
          <strong>{t.addPublicResult}</strong>
          <p>{t.addPublicResultHint}</p>
        </div>
        <div className="public-url-row">
          <label>
            <span>{t.sourceUrl}</span>
            <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder="https://..." />
          </label>
          <button className="primary-action compact-action" type="button" onClick={addLink} disabled={!draftUrl.trim() || draftLoading}>
            <Check size={16} />
            <span>{draftLoading ? t.publicInfoSearching : t.save}</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function PublicInfoPreviewCard({
  link,
  t,
  action,
  meta
}: {
  link: PublicInfoPreview | PublicInfoLink;
  t: Record<string, string>;
  action?: ReactNode;
  meta?: string;
}) {
  const fallbackLabel = getPublicPreviewFallbackLabel(link.url);

  return (
    <div className="public-preview-card">
      <a className="public-preview-media" href={link.url} target="_blank" rel="noreferrer" aria-label={t.openSource}>
        <span className="public-preview-fallback">{fallbackLabel}</span>
        {link.imageUrl ? <img src={link.imageUrl} alt="" loading="lazy" /> : null}
      </a>
      <div>
        <a className="public-preview-title" href={link.url} target="_blank" rel="noreferrer">
          <span>{link.title || link.url}</span>
          <SquareArrowOutUpRight size={14} />
        </a>
        {link.snippet ? <p>{link.snippet}</p> : null}
        {meta ? <small>{meta}</small> : null}
      </div>
      {action ? <div className="public-preview-action">{action}</div> : null}
    </div>
  );
}

function StarMapPanel({ person, t, onEdit }: { person: Person; t: Record<string, string>; onEdit: () => void }) {
  const starMap = buildStarMap(person);
  const coordsFromCity = !hasExactBirthCoordinates(person) && Boolean(resolveBirthLocation(person));

  if (!starMap) {
    return (
      <section className="star-map-panel empty-star-map">
        <div className="empty-inline">
          <p>{t.starMapMissing}</p>
          <small>{t.starMapMissingHint}</small>
        </div>
        <div className="profile-actions">
          <button className="primary-action" type="button" onClick={onEdit}>
            <Pencil size={17} />
            <span>{t.editBirthMoment}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="star-map-panel">
      <div className="star-map-card">
        <svg className="star-map-svg" viewBox="0 0 500 500" role="img" aria-label={t.starMap}>
          <defs>
            <radialGradient id={`star-map-bg-${person.id}`} cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#203855" />
              <stop offset="62%" stopColor="#102337" />
              <stop offset="100%" stopColor="#07131f" />
            </radialGradient>
          </defs>
          <circle cx="250" cy="250" r="238" fill={`url(#star-map-bg-${person.id})`} />
          <circle cx="250" cy="250" r="238" fill="none" stroke="rgba(255,255,255,.48)" strokeWidth="2" />
          <circle cx="250" cy="250" r="158" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
          <circle cx="250" cy="250" r="79" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" />
          <line x1="250" y1="12" x2="250" y2="488" stroke="rgba(255,255,255,.09)" />
          <line x1="12" y1="250" x2="488" y2="250" stroke="rgba(255,255,255,.09)" />
          {starMap.lines.map((line) => (
            <line
              key={line.id}
              x1={line.from.x}
              y1={line.from.y}
              x2={line.to.x}
              y2={line.to.y}
              stroke="rgba(255,255,255,.18)"
              strokeWidth="1.2"
            />
          ))}
          {starMap.stars.map((star) => (
            <g key={star.id}>
              <circle
                cx={star.x}
                cy={star.y}
                r={star.radius}
                fill="#fff8dd"
                opacity={star.opacity}
              />
              {star.label ? (
                <text x={star.x + 6} y={star.y - 4} fill="rgba(255,255,255,.82)" fontSize="10" fontWeight="700">
                  {star.label}
                </text>
              ) : null}
            </g>
          ))}
          <text x="250" y="34" textAnchor="middle" fill="rgba(255,255,255,.76)" fontSize="12" fontWeight="800">
            N
          </text>
          <text x="250" y="480" textAnchor="middle" fill="rgba(255,255,255,.55)" fontSize="11" fontWeight="800">
            S
          </text>
          <text x="24" y="255" textAnchor="middle" fill="rgba(255,255,255,.55)" fontSize="11" fontWeight="800">
            O
          </text>
          <text x="476" y="255" textAnchor="middle" fill="rgba(255,255,255,.55)" fontSize="11" fontWeight="800">
            E
          </text>
        </svg>
        <div className="star-map-caption">
          <span className="eyebrow">{t.starMap}</span>
          <h3>{fullName(person) || t.person}</h3>
          <p>{starMap.label}</p>
          <small>{coordsFromCity ? t.starMapUsesCityCoordinates : t.starMapApproximateHint}</small>
        </div>
      </div>
    </section>
  );
}

function ReadOnlyField({
  label,
  value,
  fallback,
  warning
}: {
  label: string;
  value?: string;
  fallback: string;
  warning?: string;
}) {
  return (
    <div className={`readonly-field ${warning ? "warning" : ""}`} title={warning}>
      <span>{label}</span>
      <strong>{value?.trim() || fallback}</strong>
      {warning ? <small>{warning}</small> : null}
    </div>
  );
}

function BirthSummaryField({
  person,
  birthPlace,
  label,
  fallback,
  warning,
  cachedFamousBirth,
  onSaveFamousBirth,
  t
}: {
  person: Person;
  birthPlace: { city: string; country: string };
  label: string;
  fallback: string;
  warning?: string;
  cachedFamousBirth?: FamousBirthMatch | null;
  onSaveFamousBirth: (cacheKey: string, match: FamousBirthMatch | null) => void;
  t: Record<string, string>;
}) {
  const birthDate = parseFullDateParts(person.birthDate);
  const [famousBirth, setFamousBirth] = useState<FamousBirthMatch | null>(null);
  const [status, setStatus] = useState("");
  const summary = formatBirthSummary(person, birthPlace, fallback);

  useEffect(() => {
    let cancelled = false;

    async function loadFamousBirth() {
      if (!birthDate) {
        setFamousBirth(null);
        setStatus("");
        return;
      }

      const cacheKey = getFamousBirthCacheKey(birthDate.year, birthDate.month, birthDate.day);
      if (cachedFamousBirth !== undefined) {
        setFamousBirth(cachedFamousBirth);
        setStatus(cachedFamousBirth ? "" : t.noWorldHistory);
        return;
      }

      setStatus(t.publicInfoSearching);
      try {
        const match = await fetchFamousBirthForDate(birthDate.year, birthDate.month, birthDate.day, fullName(person));
        if (cancelled) return;
        setFamousBirth(match);
        setStatus(match ? "" : t.noWorldHistory);
        onSaveFamousBirth(cacheKey, match);
      } catch {
        if (!cancelled) {
          setFamousBirth(null);
          setStatus(t.publicInfoSearchError);
        }
      }
    }

    void loadFamousBirth();
    return () => {
      cancelled = true;
    };
  }, [birthDate?.day, birthDate?.month, cachedFamousBirth, onSaveFamousBirth, person.givenName, person.familyName, t]);

  return (
    <div className={`readonly-field birth-summary-field ${warning ? "warning" : ""}`} title={warning}>
      <span>{label}</span>
      <strong>{summary}</strong>
      {birthDate ? (
        famousBirth ? (
          <small>
            El mismo día que{" "}
            <a href={getFamousBirthWikipediaUrl(famousBirth)} target="_blank" rel="noreferrer">
              {famousBirth.name}
            </a>
            .{" "}
            <a className="inline-source-link" href={famousBirth.sourceUrl} target="_blank" rel="noreferrer">
              Fuente: Mediamass
            </a>
          </small>
        ) : status ? (
          <small>{status}</small>
        ) : null
      ) : null}
      {warning ? <small>{warning}</small> : null}
    </div>
  );
}

function GivenNameReadOnlyField({
  label,
  value,
  fallback,
  onOpenGivenName
}: {
  label: string;
  value?: string;
  fallback: string;
  onOpenGivenName: (name: string) => void;
}) {
  const firstName = extractFirstGivenName(value ?? "");

  return (
    <div className="readonly-field">
      <span>{label}</span>
      {firstName ? (
        <div className="surname-links name-links">
          <button type="button" onClick={() => onOpenGivenName(firstName)}>
            {value}
          </button>
        </div>
      ) : (
        <strong>{fallback}</strong>
      )}
    </div>
  );
}

function SurnameReadOnlyField({
  label,
  value,
  surnames,
  fallback,
  onOpenSurname
}: {
  label: string;
  value?: string;
  surnames: string[];
  fallback: string;
  onOpenSurname: (surname: string) => void;
}) {
  return (
    <div className="readonly-field">
      <span>{label}</span>
      {surnames.length > 0 ? (
        <div className="surname-links">
          {surnames.map((surname) => (
            <button type="button" key={surname} onClick={() => onOpenSurname(surname)}>
              {surname}
            </button>
          ))}
        </div>
      ) : (
        <strong>{value?.trim() || fallback}</strong>
      )}
    </div>
  );
}

function GivenNameMeaningPanel({
  name,
  profile,
  status,
  t
}: {
  name: string;
  profile?: GivenNameProfile;
  status: string;
  t: Record<string, string>;
}) {
  const preview = profile?.meaning ? truncateMeaningPreview(profile.meaning) : null;

  return (
    <div className="name-meaning-panel">
      {profile?.meaning && preview ? (
        <>
          <section className="profile-notes name-meaning-notes">
            <strong>{t.nameMeaning}</strong>
            <p>
              {preview.text}
              {preview.truncated ? "..." : ""}
              {preview.truncated ? (
                <>
                  {" "}
                  <a className="read-full-link" href={profile.sourceUrl} target="_blank" rel="noreferrer">
                    {t.readFull}
                  </a>
                </>
              ) : null}
            </p>
          </section>
          <a className="source-badge" href={profile.sourceUrl} target="_blank" rel="noreferrer">
            <SquareArrowOutUpRight size={13} />
            <span>{t.nameMeaningSource.replace("{source}", profile.sourceName)}</span>
          </a>
        </>
      ) : (
        <div className="empty-inline">
          <p>{t.noNameMeaning.replace("{name}", name)}</p>
        </div>
      )}
      {status ? <p className="surname-status">{status}</p> : null}
    </div>
  );
}

function formatGender(gender: Person["gender"], t: Record<string, string>) {
  if (gender === "female") return t.female;
  if (gender === "male") return t.male;
  if (gender === "non_binary") return t.nonBinary;
  return t.unknownGender;
}

function getGenderSymbol(gender: Person["gender"]) {
  if (gender === "female") return "♀";
  if (gender === "male") return "♂";
  if (gender === "non_binary") return "⚧";
  return "?";
}

function formatBirthDateTime(date?: string, time?: string) {
  return [date, time].map((part) => part?.trim()).filter(Boolean).join(" · ");
}

function truncateMeaningPreview(value: string, maxWords = 44) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return { text: words.join(" "), truncated: false };
  }

  return {
    text: words.slice(0, maxWords).join(" "),
    truncated: true
  };
}

function PersonEditor({
  person,
  t,
  onChange,
  onSave,
  onRequestInfo
}: {
  person: Person;
  t: Record<string, string>;
  onChange: (patch: Partial<Person>) => void;
  onSave: () => void;
  onRequestInfo: () => void;
}) {
  const birthPlace = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const isDeceased = person.isDeceased ?? Boolean(person.deathDate);

  function handlePhotoChange(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert(t.photoInvalid);
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        onChange({ photoUrl: reader.result });
      }
    });
    reader.readAsDataURL(file);
  }

  return (
    <div className="editor-form">
      <section className="photo-editor">
        <span className="portrait large" style={{ backgroundImage: person.photoUrl ? `url(${person.photoUrl})` : undefined }}>
          {!person.photoUrl ? person.givenName.slice(0, 1) : null}
        </span>
        <div className="photo-actions">
          <label className="secondary-action">
            <ImagePlus size={17} />
            <span>{person.photoUrl ? t.changePhoto : t.addPhoto}</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => handlePhotoChange(event.target.files?.[0])}
            />
          </label>
          {person.photoUrl ? (
            <button className="secondary-action subtle" type="button" onClick={() => onChange({ photoUrl: "" })}>
              <X size={17} />
              <span>{t.removePhoto}</span>
            </button>
          ) : null}
        </div>
      </section>
      <label>
        <span>{t.givenName}</span>
        <input value={person.givenName} onChange={(event) => onChange({ givenName: event.target.value })} />
      </label>
      <label>
        <span>{t.familyName}</span>
        <input value={person.familyName} onChange={(event) => onChange({ familyName: event.target.value })} />
      </label>
      <label>
        <span>{t.gender}</span>
        <select
          value={person.gender}
          onChange={(event) => onChange({ gender: event.target.value as Person["gender"] })}
        >
          <option value="unknown">{t.unknownGender}</option>
          <option value="female">{t.female}</option>
          <option value="male">{t.male}</option>
          <option value="non_binary">{t.nonBinary}</option>
        </select>
      </label>
      <label>
        <span>{t.birthDate}</span>
        <input
          value={person.birthDate ?? ""}
          placeholder="DD/MM/AAAA"
          onChange={(event) => onChange({ birthDate: event.target.value })}
        />
      </label>
      <label>
        <span>{t.birthTime}</span>
        <input
          type="time"
          value={person.birthTime ?? ""}
          onChange={(event) => onChange({ birthTime: event.target.value })}
        />
      </label>
      <div className="editor-row">
        <label>
          <span>{t.birthCity}</span>
          <input
            value={birthPlace.city}
            onChange={(event) =>
              onChange({
                birthCity: event.target.value,
                birthCountry: birthPlace.country,
                birthPlace: joinPlace(event.target.value, birthPlace.country)
              })
            }
          />
        </label>
        <label>
          <span>{t.birthCountry}</span>
          <input
            value={birthPlace.country}
            onChange={(event) =>
              onChange({
                birthCity: birthPlace.city,
                birthCountry: event.target.value,
                birthPlace: joinPlace(birthPlace.city, event.target.value)
              })
            }
          />
        </label>
      </div>
      <div className="editor-row">
        <label>
          <span>{t.birthLatitude}</span>
          <input
            type="number"
            step="0.000001"
            value={person.birthLatitude ?? ""}
            onChange={(event) => onChange({ birthLatitude: parseOptionalNumber(event.target.value) })}
          />
        </label>
        <label>
          <span>{t.birthLongitude}</span>
          <input
            type="number"
            step="0.000001"
            value={person.birthLongitude ?? ""}
            onChange={(event) => onChange({ birthLongitude: parseOptionalNumber(event.target.value) })}
          />
        </label>
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={isDeceased}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? { isDeceased: true }
                : { isDeceased: false, deathDate: "", deathCity: "", deathCountry: "", deathPlace: "" }
            )
          }
        />
        <span>{t.isDeceased}</span>
      </label>
      {isDeceased ? (
        <>
          <label>
            <span>{t.deathDate}</span>
            <input
              value={person.deathDate ?? ""}
              placeholder="DD/MM/AAAA"
              onChange={(event) => onChange({ deathDate: event.target.value, isDeceased: true })}
            />
          </label>
        </>
      ) : null}
      <div className="profile-actions">
        <button className="secondary-action" type="button" onClick={onRequestInfo}>
          <Mail size={17} />
          <span>{t.requestInfo}</span>
        </button>
        <button className="primary-action" type="button" onClick={onSave}>
          <Check size={17} />
          <span>{t.save}</span>
        </button>
      </div>
    </div>
  );
}

function LanguageButtons({
  locale,
  switchLocale
}: {
  locale: Locale;
  switchLocale: (locale: Locale) => void;
}) {
  const languageOptions: Array<{ locale: Locale; label: string }> = [
    { locale: "es", label: "ES" },
    { locale: "en", label: "EN" },
    { locale: "ca", label: "CA" },
    { locale: "gl", label: "GL" },
    { locale: "eu", label: "EU" }
  ];

  return (
    <div className="language-switch" aria-label="Language">
      <Languages size={17} />
      {languageOptions.map((option) => (
        <button
          className={locale === option.locale ? "active" : ""}
          key={option.locale}
          onClick={() => switchLocale(option.locale)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function LanguageSelect({
  locale,
  switchLocale
}: {
  locale: Locale;
  switchLocale: (locale: Locale) => void;
}) {
  const languageOptions: Array<{ locale: Locale; label: string }> = [
    { locale: "es", label: "Español" },
    { locale: "en", label: "English" },
    { locale: "ca", label: "Català" },
    { locale: "gl", label: "Galego" },
    { locale: "eu", label: "Euskara" }
  ];

  return (
    <span className="language-select">
      <select value={locale} onChange={(event) => switchLocale(event.target.value as Locale)}>
        {languageOptions.map((option) => (
          <option key={option.locale} value={option.locale}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function FontAwesomeShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      role="img"
    >
      <path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8C480 92.3 496 114.2 496 139.6c0 207.5-126.4 353.2-238.4 371.1c-1.1 .2-2.2 .3-3.3 .3s-2.2-.1-3.3-.3C139.4 492.8 16 347.1 16 139.6c0-25.4 16-47.3 38.3-56.8L242.6 2.9C246.8 1 251.4 0 256 0z" />
    </svg>
  );
}

function FontAwesomeEarthEuropeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      role="img"
    >
      <path d="M256.2 48c114.8 .1 207.8 93.2 207.8 208 0 22.1-3.4 43.4-9.8 63.4-2 .4-4.1 .6-6.2 .6l-2.7 0c-8.5 0-16.6-3.4-22.6-9.4l-29.3-29.3c-6-6-9.4-14.1-9.4-22.6l0-50.7c0-8.8 7.2-16 16-16s16-7.2 16-16-7.2-16-16-16l-24 0c-13.3 0-24 10.7-24 24s-10.7 24-24 24l-56 0c-8.8 0-16 7.2-16 16s-7.2 16-16 16l-25.4 0c-12.5 0-22.6-10.1-22.6-22.6 0-6 2.4-11.8 6.6-16l70.1-70.1c2.1-2.1 3.3-5 3.3-8 0-6.2-5.1-11.3-11.3-11.3l-14.1 0c-12.5 0-22.6-10.1-22.6-22.6 0-6 2.4-11.8 6.6-16l23.1-23.1c.8-.8 1.6-1.5 2.5-2.2zM438.4 356.1c-32.8 59.6-93.9 101.4-165.2 107.2-.7-2.3-1.1-4.8-1.1-7.3 0-13.3-10.7-24-24-24l-26.7 0c-8.5 0-16.6-3.4-22.6-9.4l-29.3-29.3c-6-6-9.4-14.1-9.4-22.6l0-66.7c0-17.7 14.3-32 32-32l98.7 0c8.5 0 16.6 3.4 22.6 9.4l29.3 29.3c6 6 14.1 9.4 22.6 9.4l5.5 0c8.5 0 16.6 3.4 22.6 9.4l16 16c4.2 4.2 10 6.6 16 6.6 4.8 0 9.3 1.5 13 4.1zM256 512l26.2-1.3c-8.6 .9-17.3 1.3-26.2 1.3zm26.2-1.3C411.3 497.6 512 388.6 512 256 512 114.6 397.4 0 256 0l0 0C114.6 0 0 114.6 0 256 0 383.5 93.2 489.3 215.3 508.8 228.5 510.9 242.1 512 256 512zM187.3 123.3l-32 32c-6.2 6.2-16.4 6.2-22.6 0s-6.2-16.4 0-22.6l32-32c6.2-6.2 16.4-6.2 22.6 0s6.2 16.4 0 22.6z" />
    </svg>
  );
}

function FontAwesomeCrossIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 448 512"
      fill="currentColor"
      role="img"
    >
      <path d="M176 0c-17.7 0-32 14.3-32 32l0 96-96 0c-17.7 0-32 14.3-32 32l0 64c0 17.7 14.3 32 32 32l96 0 0 224c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-224 96 0c17.7 0 32-14.3 32-32l0-64c0-17.7-14.3-32-32-32l-96 0 0-96c0-17.7-14.3-32-32-32L176 0z" />
    </svg>
  );
}

function ContributionDiffTable({
  title,
  person,
  patch,
  contribution,
  t,
  onAcceptField,
  onRejectField
}: {
  title: string;
  person: Person;
  patch: ContributionRecord["personPatch"];
  contribution: ContributionRecord;
  t: Record<string, string>;
  onAcceptField: (
    contribution: ContributionRecord,
    targetPersonId: string,
    field: keyof ContributionRecord["personPatch"]
  ) => void;
  onRejectField: (
    contribution: ContributionRecord,
    targetPersonId: string,
    field: keyof ContributionRecord["personPatch"]
  ) => void;
}) {
  const rows = contributionFields(t).filter((field) => patch[field.key] !== undefined);

  if (rows.length === 0) return null;

  return (
    <section className="diff-section">
      <h3>{title}</h3>
      <div className="diff-table">
        {rows.map((field) => (
          <div className="diff-row" key={field.key}>
            <span>{field.label}</span>
            <strong>{formatContributionValue(person[field.key]) || t.emptyValue}</strong>
            <strong>{formatContributionValue(patch[field.key]) || t.emptyValue}</strong>
            <div className="row-actions">
              <button
                type="button"
                title={t.acceptField}
                aria-label={t.acceptField}
                onClick={() => onAcceptField(contribution, person.id, field.key)}
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                title={t.rejectField}
                aria-label={t.rejectField}
                onClick={() => onRejectField(contribution, person.id, field.key)}
              >
                <X size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContributionSource({
  source,
  t
}: {
  source: NonNullable<ContributionRecord["source"]>;
  t: Record<string, string>;
}) {
  return (
    <section className="source-summary">
      <div>
        <strong>{source.title || t.externalSource}</strong>
        <p>{[source.archive, source.signature, source.date].filter(Boolean).join(" · ") || t.emptyValue}</p>
      </div>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noreferrer">
          <SquareArrowOutUpRight size={16} />
          <span>{t.openSource}</span>
        </a>
      ) : null}
      {source.notes ? <p>{source.notes}</p> : null}
    </section>
  );
}

interface SurnameSummary {
  surname: string;
  count: number;
  people: Person[];
  places: string[];
}

function SurnamesView({
  people,
  profiles,
  selectedSurname,
  status,
  t,
  onSelect,
  onUpdate,
  onFetchAllMeanings,
  onBack,
}: {
  people: Person[];
  profiles: Record<string, SurnameProfile>;
  selectedSurname: string;
  status: string;
  t: Record<string, string>;
  onSelect: (surname: string) => void;
  onUpdate: (surname: string, patch: Partial<SurnameProfile>) => void;
  onFetchAllMeanings: () => void;
  onBack: () => void;
}) {
  const summaries = useMemo(() => buildSurnameSummaries(people), [people]);
  const selectedSummary = summaries.find((summary) => summary.surname === selectedSurname) ?? summaries[0];
  const profile = selectedSummary ? profiles[normalizeSurnameKey(selectedSummary.surname)] : null;
  const readableMeaning =
    selectedSummary && profile?.meaning ? cleanGeneanetMeaningForSurname(profile.meaning, selectedSummary.surname) : "";

  return (
    <section className="surnames-view">
      <header className="people-view-header">
        <h1>{t.surnames}</h1>
        <button className="secondary-action compact-action" type="button" onClick={onBack}>
          <TreePine size={15} />
          <span>{t.treeMap}</span>
        </button>
      </header>
      {summaries.length === 0 || !selectedSummary ? (
        <section className="empty-state">
          <Fingerprint size={34} />
          <h2>{t.noSurnames}</h2>
          <p>{t.noSurnamesHint}</p>
        </section>
      ) : (
        <div className="surnames-layout">
          <aside className="surname-list">
            {summaries.map((summary) => (
              <button
                className={summary.surname === selectedSummary.surname ? "active" : ""}
                type="button"
                key={summary.surname}
                onClick={() => onSelect(summary.surname)}
              >
                <strong>{summary.surname}</strong>
                <span>{summary.count}</span>
              </button>
            ))}
          </aside>
          <div className="surname-detail">
            <section className="surname-panel surname-hero">
              <div className="surname-hero-main">
                <a
                  className="surname-coat"
                  href={profile?.coatOfArmsSourceUrl || heraldicaFamiliarSurnameUrl(selectedSummary.surname)}
                  target="_blank"
                  rel="noreferrer"
                  title={profile?.coatOfArmsUrl ? t.coatOfArms : t.noCoatOfArms}
                >
                  {profile?.coatOfArmsUrl ? (
                    <img src={profile.coatOfArmsUrl} alt={`${t.coatOfArms} ${selectedSummary.surname}`} />
                  ) : (
                    <FontAwesomeShieldIcon size={26} />
                  )}
                </a>
                <div>
                  <span className="eyebrow">{t.surname}</span>
                  <h2>{selectedSummary.surname}</h2>
                  <p>
                    {t.surnamePeopleCount.replace("{count}", String(selectedSummary.count))}
                  </p>
                </div>
              </div>
              <div className="surname-actions">
                <button className="primary-action" type="button" onClick={onFetchAllMeanings}>
                  <RefreshCw size={17} />
                  <span>{t.fetchAllSurnameMeanings}</span>
                </button>
              </div>
            </section>

            {status ? <p className="surname-status">{status}</p> : null}

            <section className="surname-panel">
              <header>
                <h3>{t.ineData}</h3>
                <a href={ineSurnameWidgetUrl()} target="_blank" rel="noreferrer">
                  <SquareArrowOutUpRight size={15} />
                  <span>{t.ineSource}</span>
                </a>
              </header>
              <IneSurnamePanel ine={profile?.ine} t={t} />
            </section>

            <section className="surname-panel">
              <header>
                <h3>{t.forebearsData}</h3>
                <a href={forebearsSurnameUrl(selectedSummary.surname)} target="_blank" rel="noreferrer">
                  <SquareArrowOutUpRight size={15} />
                  <span>{t.forebearsSource}</span>
                </a>
              </header>
              <ForebearsSurnamePanel forebears={profile?.forebears} t={t} />
            </section>

            <section className="surname-panel">
              <header>
                <h3>{t.surnameResearch}</h3>
                {profile?.originSourceUrl ? (
                  <a href={profile.originSourceUrl} target="_blank" rel="noreferrer">
                    <SquareArrowOutUpRight size={15} />
                    <span>{profile.originSourceName || t.openSource}</span>
                  </a>
                ) : null}
              </header>
              {readableMeaning ? (
                <div className="surname-meaning-readonly">
                  {readableMeaning
                    .split(/\n{2,}/)
                    .map((paragraph) => paragraph.trim())
                    .filter(Boolean)
                    .map((paragraph, index) => (
                      <p key={`${selectedSummary.surname}-meaning-${index}`}>{paragraph}</p>
                    ))}
                </div>
              ) : (
                <div className="empty-inline">
                  <p>{t.surnameMeaningEmpty}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function IneSurnamePanel({ ine, t }: { ine?: SurnameProfile["ine"]; t: Record<string, string> }) {
  if (!ine) {
    return (
      <div className="empty-inline">
        <p>{t.noIneSurnameData}</p>
      </div>
    );
  }
  const topProvinces = buildTopIneSurnameProvinces(ine);
  const frequency = getSpanishSurnameFrequencyValue((ine.totalFirst ?? 0) + (ine.totalSecond ?? 0), t);

  return (
    <div className="ine-surname">
      <div className="ine-summary-grid">
        <InePeopleMetric
          title={t.peopleInSpain}
          rows={[
            { label: t.firstSurname, value: formatThousands(ine.totalFirst) },
            { label: t.secondSurname, value: formatThousands(ine.totalSecond) },
            { label: t.frequencyLabel, value: frequency }
          ]}
        />
        <ProvinceRanking title={t.topSurnameProvinces} rows={topProvinces} />
      </div>
      <p className="source-note">
        {t.ineCitation.replace("{date}", formatDateShort(ine.fetchedAt))}
      </p>
    </div>
  );
}

function buildTopIneSurnameProvinces(ine: NonNullable<SurnameProfile["ine"]>) {
  const provinceMap = new Map<string, { name: string; value: number; unit: string }>();

  [...(ine.provinceFirst ?? []), ...(ine.provinceSecond ?? [])].forEach((province) => {
    const current = provinceMap.get(province.name);
    provinceMap.set(province.name, {
      name: province.name,
      value: (current?.value ?? 0) + province.value,
      unit: province.unit || current?.unit || "‰"
    });
  });

  return [...provinceMap.values()].sort((first, second) => second.value - first.value).slice(0, 3);
}

function InePeopleMetric({
  title,
  rows
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <article className="ine-people-card">
      <h4>{title}</h4>
      <div className="ine-people-lines">
        {rows.map((row) => (
          <div className="ine-people-line" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProvinceRanking({
  title,
  rows
}: {
  title: string;
  rows: Array<{ name: string; value: number; unit: string }>;
}) {
  return (
    <article className="province-ranking">
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p>Sin datos</p>
      ) : (
        <div className="province-ranking-list">
          {rows.slice(0, 3).map((row) => (
            <div className="province-ranking-row" key={`${title}-${row.name}`}>
              <span>{row.name}</span>
              <strong>
                {formatDecimalNumber(row.value, 1)} {row.unit}
              </strong>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ForebearsSurnamePanel({
  forebears,
  t
}: {
  forebears?: SurnameProfile["forebears"];
  t: Record<string, string>;
}) {
  if (!forebears) {
    return (
      <div className="empty-inline">
        <p>{t.noForebearsSurnameData}</p>
      </div>
    );
  }

  return (
    <div className="forebears-surname">
      <div className="forebears-summary-grid">
        <article className="forebears-card">
          <h4>{t.worldPresence}</h4>
          <div className="forebears-main-number">
            <strong>{formatThousands(forebears.totalWorld)}</strong>
            {forebears.worldRank ? <span>#{formatNumber(forebears.worldRank)}</span> : null}
          </div>
        </article>
        <article className="forebears-card">
          <h4>{t.mostPrevalentCountry}</h4>
          <CountryValue country={forebears.mostPrevalentCountry} fallback={t.emptyValue} />
        </article>
        <article className="forebears-card">
          <h4>{t.highestDensityCountry}</h4>
          <CountryValue country={forebears.highestDensityCountry} fallback={t.emptyValue} />
        </article>
      </div>
      {forebears.countries.length > 0 ? (
        <article className="forebears-card forebears-countries">
          <h4>{t.topCountries}</h4>
          <div className="province-ranking-list">
            {forebears.countries.slice(0, 5).map((row) => (
              <div className="province-ranking-row" key={row.country}>
                <span>{row.country}</span>
                <strong>{formatThousands(row.incidence)}</strong>
              </div>
            ))}
          </div>
        </article>
      ) : null}
      <p className="source-note">
        {t.forebearsCitation.replace("{date}", formatDateShort(forebears.fetchedAt))}
      </p>
    </div>
  );
}

function CountryValue({ country, fallback }: { country?: string; fallback: string }) {
  const value = cleanCountryName(country);
  const flagUrl = value ? countryFlagUrl(value) : "";

  return (
    <strong className="country-value">
      {flagUrl ? <img src={flagUrl} alt="" loading="lazy" /> : null}
      <span>{value || fallback}</span>
    </strong>
  );
}

function OriginSuggestions({
  suggestions,
  t,
  onAccept,
  onReject
}: {
  suggestions: NonNullable<SurnameProfile["originSuggestions"]>;
  t: Record<string, string>;
  onAccept: (suggestionId: string) => void;
  onReject: (suggestionId: string) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <div className="empty-inline">
        <p>{t.noSurnameOriginSuggestions}</p>
      </div>
    );
  }

  return (
    <div className="origin-suggestions">
      {suggestions.map((suggestion) => (
        <article className={`origin-suggestion ${suggestion.status}`} key={suggestion.id}>
          <header>
            <div>
              <span>{suggestion.sourceName}</span>
              <strong>{suggestion.title}</strong>
            </div>
            <a href={suggestion.sourceUrl} target="_blank" rel="noreferrer">
              <SquareArrowOutUpRight size={14} />
              <span>{t.openSource}</span>
            </a>
          </header>
          <p>{suggestion.excerpt}</p>
          <footer>
            <span>{t[`status_${suggestion.status}`] ?? suggestion.status}</span>
            <div>
              <button className="secondary-action" type="button" onClick={() => onReject(suggestion.id)}>
                <X size={15} />
                <span>{t.rejectField}</span>
              </button>
              <button className="primary-action" type="button" onClick={() => onAccept(suggestion.id)}>
                <Check size={15} />
                <span>{t.acceptField}</span>
              </button>
            </div>
          </footer>
        </article>
      ))}
    </div>
  );
}

interface MapLocatedGroup {
  label: string;
  people: Person[];
  coords: {
    lat: number;
    lng: number;
  };
  communityCode?: string;
}

interface MigrationMapGroup extends MapLocatedGroup {
  generationIndex: number;
  generationLabel: string;
  generationIndexes: number[];
  flagUrl?: string;
}

interface MigrationMapLink {
  from: MigrationMapGroup;
  to: MigrationMapGroup;
  count: number;
  people: Person[];
  type: "descent" | "external_partner";
}

interface MigrationMapData {
  groups: MigrationMapGroup[];
  links: MigrationMapLink[];
}

interface GeocodeResult {
  coords: {
    lat: number;
    lng: number;
  };
  communityCode?: string;
  label?: string;
  fromCache: boolean;
}

function BirthMapView({
  people,
  relationships,
  photos,
  selectedId,
  t,
  showPhotos,
  onSelect
}: {
  people: Person[];
  relationships: Relationship[];
  photos: GalleryPhoto[];
  selectedId: string;
  t: Record<string, string>;
  showPhotos: boolean;
  onSelect: (person: Person) => void;
}) {
  const [mapMode, setMapMode] = useState<"people" | "photos" | "migrations">("people");
  const [mapStatus, setMapStatus] = useState("");
  const mapElementRef = useRef<HTMLDivElement>(null);
  const birthPlaceGroups = useMemo(() => {
    const groups = new Map<string, { label: string; people: Person[] }>();

    people.forEach((person) => {
      const label = getBirthAddress(person);
      if (!label) return;

      const group = groups.get(label) ?? { label, people: [] };
      group.people.push(person);
      groups.set(label, group);
    });

    return [...groups.values()];
  }, [people]);
  const locatedPhotos = useMemo(() => photos.filter(hasGalleryPhotoCoordinates), [photos]);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: { remove: () => void } | null = null;

    async function drawMap() {
      if (!mapElementRef.current) return;

      setMapStatus(t.loadingMap);
      mapElementRef.current.innerHTML = "";

      try {
        if (mapMode === "photos") {
          if (locatedPhotos.length === 0) {
            setMapStatus(t.galleryMapNoLocatedPhotos);
            return;
          }

          if (cancelled || !mapElementRef.current) return;
          mapInstance = await drawLeafletPhotoMap(mapElementRef.current, locatedPhotos, t);
          if (!cancelled) setMapStatus("");
          return;
        }

        if (mapMode === "migrations") {
          const migrationMapData = await buildMigrationMapGroups(people, relationships, birthPlaceGroups, () => cancelled);
          if (cancelled) return;

          if (migrationMapData.groups.length === 0) {
            setMapStatus(t.noMapLocationsHint);
            return;
          }

          if (cancelled || !mapElementRef.current) return;
          mapInstance = await drawLeafletMigrationMap(mapElementRef.current, migrationMapData);
          if (!cancelled) setMapStatus("");
          return;
        }

        const nextLocatedGroups: MapLocatedGroup[] = [];
        for (let index = 0; index < birthPlaceGroups.length; index += 1) {
          const group = birthPlaceGroups[index];
          const location = await geocodeAddress(group.label);
          if (cancelled) return;

          if (!location?.coords) continue;

          nextLocatedGroups.push({ ...group, coords: location.coords });

          if (!location.fromCache && index < birthPlaceGroups.length - 1) {
            await sleep(1100);
          }
        }

        if (nextLocatedGroups.length === 0) {
          setMapStatus(t.noMapLocationsHint);
          return;
        }

        if (cancelled || !mapElementRef.current) return;

        mapInstance = await drawLeafletBirthMap(mapElementRef.current, nextLocatedGroups, showPhotos, onSelect);
        if (!cancelled) setMapStatus("");
      } catch {
        setMapStatus(t.openStreetMapLoadError);
      }
    }

    void drawMap();

    return () => {
      cancelled = true;
      mapInstance?.remove();
    };
  }, [birthPlaceGroups, locatedPhotos, mapMode, onSelect, people, relationships, showPhotos, t]);

  return (
    <section className="map-view">
      <header className="people-view-header map-view-header">
        <h1>{t.birthMap}</h1>
        <div className="map-mode-actions">
          <button
            className={mapMode === "people" ? "active" : ""}
            type="button"
            onClick={() => setMapMode("people")}
          >
            <Users size={15} />
            <span>{t.people}</span>
          </button>
          <button
            className={mapMode === "photos" ? "active" : ""}
            type="button"
            onClick={() => setMapMode("photos")}
          >
            <Image size={15} />
            <span>{t.gallery}</span>
          </button>
          <button
            className={mapMode === "migrations" ? "active" : ""}
            type="button"
            onClick={() => setMapMode("migrations")}
          >
            <Route size={15} />
            <span>{t.origins}</span>
          </button>
        </div>
      </header>
      <div className={`map-layout map-layout-${mapMode}`}>
        <div className="map-panel">
          <div className="map-canvas" ref={mapElementRef} aria-label={t.birthMap} />
          {mapStatus ? <p className="map-status">{mapStatus}</p> : null}
        </div>
      </div>
    </section>
  );
}

async function buildMigrationMapGroups(
  people: Person[],
  relationships: Relationship[],
  birthPlaceGroups: Array<{ label: string; people: Person[] }>,
  isCancelled: () => boolean
): Promise<MigrationMapData> {
  const locatedGroups: MapLocatedGroup[] = [];

  for (let index = 0; index < birthPlaceGroups.length; index += 1) {
    const group = birthPlaceGroups[index];
    const location = await geocodeAddress(group.label);
    if (isCancelled()) return { groups: [], links: [] };
    if (!location?.coords) continue;

    locatedGroups.push({ ...group, coords: location.coords, communityCode: location.communityCode });
    if (!location.fromCache && index < birthPlaceGroups.length - 1) {
      await sleep(1100);
    }
  }

  const peopleGenerationMap = new Map<string, RegionalGeneration>();
  buildRegionalGenerations(people.filter((person) => getBirthAddress(person)), relationships).forEach((generation) => {
    generation.people.forEach((person) => peopleGenerationMap.set(person.id, generation));
  });

  const migrationGroups = new Map<string, MigrationMapGroup>();
  const personGroupMap = new Map<string, MigrationMapGroup>();
  locatedGroups.forEach((group) => {
    group.people.forEach((person) => {
      const generation = peopleGenerationMap.get(person.id);
      if (!generation) return;

      const community = getKnownAutonomousCommunityForPerson(person) ?? getCommunityByCode(group.communityCode);
      const key = community?.code ?? group.label;
      const currentGroup = migrationGroups.get(key) ?? {
        label: community?.name ?? group.label,
        people: [],
        coords: group.coords,
        generationIndex: generation.index,
        generationLabel: generation.label,
        generationIndexes: [],
        flagUrl: community?.flagUrl
      };
      currentGroup.people.push(person);
      const currentLocationPeopleCount = group.people.length;
      const currentBestCount = Number((currentGroup as MigrationMapGroup & { bestLocationCount?: number }).bestLocationCount ?? 0);
      if (currentLocationPeopleCount > currentBestCount) {
        currentGroup.coords = group.coords;
        (currentGroup as MigrationMapGroup & { bestLocationCount?: number }).bestLocationCount = currentLocationPeopleCount;
      }
      currentGroup.generationIndex = Math.min(currentGroup.generationIndex, generation.index);
      currentGroup.generationLabel =
        currentGroup.generationIndex === generation.index ? generation.label : currentGroup.generationLabel;
      if (!currentGroup.generationIndexes.includes(generation.index)) {
        currentGroup.generationIndexes.push(generation.index);
      }
      currentGroup.generationIndexes.sort((first, second) => first - second);
      if (!currentGroup.flagUrl) {
        currentGroup.flagUrl = community?.flagUrl;
      }
      migrationGroups.set(key, currentGroup);
      personGroupMap.set(person.id, currentGroup);
    });
  });

  const groups = [...migrationGroups.values()].sort(
    (first, second) => first.generationIndex - second.generationIndex || first.label.localeCompare(second.label, "es")
  );
  const links = new Map<string, MigrationMapLink>();
  relationships
    .filter((relationship) => relationship.kind === "parent_child")
    .forEach((relationship) => {
      const from = personGroupMap.get(relationship.fromPersonId);
      const to = personGroupMap.get(relationship.toPersonId);
      const fromGeneration = peopleGenerationMap.get(relationship.fromPersonId);
      const toGeneration = peopleGenerationMap.get(relationship.toPersonId);
      if (!from || !to) return;
      if (!fromGeneration || !toGeneration) return;
      if (toGeneration.index !== fromGeneration.index + 1) return;
      if (from.label === to.label) return;

      const child = people.find((person) => person.id === relationship.toPersonId);
      const isExternalPartnerParent =
        !relationships.some(
          (candidate) => candidate.kind === "parent_child" && candidate.toPersonId === relationship.fromPersonId
        ) &&
        relationships.some(
          (candidate) =>
            ["partner", "spouse", "former_spouse"].includes(candidate.kind) &&
            (candidate.fromPersonId === relationship.fromPersonId || candidate.toPersonId === relationship.fromPersonId)
        );
      const linkType = isExternalPartnerParent ? "external_partner" : "descent";
      const key = `${from.label}::${to.label}`;
      const currentLink = links.get(key) ?? {
        from,
        to,
        count: 0,
        people: [],
        type: linkType
      };
      if (linkType === "external_partner") {
        currentLink.type = "external_partner";
      }
      currentLink.count += 1;
      if (child && !currentLink.people.some((person) => person.id === child.id)) {
        currentLink.people.push(child);
      }
      links.set(key, currentLink);
    });

  return {
    groups,
    links: [...links.values()].sort(
      (first, second) =>
        first.from.generationIndex - second.from.generationIndex ||
        first.from.label.localeCompare(second.from.label, "es") ||
        first.to.label.localeCompare(second.to.label, "es")
    )
  };
}

interface RegionalGeneration {
  index: number;
  label: string;
  people: Person[];
}

interface AutonomousCommunity {
  code: string;
  name: string;
  flagUrl: string;
  keywords: string[];
}

function RegionalGenerationTree({
  people,
  relationships,
  geocodedRegions,
  t
}: {
  people: Person[];
  relationships: Relationship[];
  geocodedRegions: Record<string, string>;
  t: Record<string, string>;
}) {
  const [resolvedRegions, setResolvedRegions] = useState<Record<string, string>>({});
  const combinedResolvedRegions = useMemo(
    () => ({ ...resolvedRegions, ...geocodedRegions }),
    [resolvedRegions, geocodedRegions]
  );
  const locatedPeople = useMemo(
    () => people.filter((person) => getBirthAddress(person)),
    [people]
  );
  const generations = useMemo(
    () => buildRegionalGenerations(locatedPeople, relationships),
    [locatedPeople, relationships]
  );
  const resolvedRegionsByAddress = useMemo(
    () => buildResolvedRegionsByAddress(locatedPeople, combinedResolvedRegions),
    [locatedPeople, combinedResolvedRegions]
  );

  useEffect(() => {
    let cancelled = false;
    const unresolvedPeople = generations
      .flatMap((generation) => generation.people)
      .filter((person) => !getCommunityForPerson(person, combinedResolvedRegions, resolvedRegionsByAddress) && getBirthAddress(person));

    async function resolveRegions() {
      for (const person of unresolvedPeople) {
        const community = await resolveAutonomousCommunityFromAddress(getBirthAddress(person));
        if (cancelled) return;
        if (community) {
          setResolvedRegions((current) => ({ ...current, [person.id]: community.code }));
        }
      }
    }

    if (unresolvedPeople.length > 0) {
      void resolveRegions();
    }

    return () => {
      cancelled = true;
    };
  }, [generations, combinedResolvedRegions, resolvedRegionsByAddress]);

  return (
    <div className="regional-tree">
      {generations.length === 0 ? (
        <div className="empty-state">
          <MapPinned size={34} />
          <h2>{t.noRegionalGenerations}</h2>
          <p>{t.noRegionalGenerationsHint}</p>
        </div>
      ) : (
        generations.map((generation) => {
          const communityGroups = groupGenerationByCommunity(generation.people, combinedResolvedRegions, resolvedRegionsByAddress);

          return (
            <section className="regional-generation" key={generation.index}>
              <header>
                <span>{generation.label}</span>
                <strong>{generation.people.length}</strong>
              </header>
              <div className="regional-person-row">
                {communityGroups.map((group) => (
                  <article className="regional-community-card" key={group.community?.code ?? "unknown"}>
                    <CommunityFlag community={group.community} />
                    <span>
                      <strong>{group.community?.name ?? t.unknownRegion}</strong>
                      <small>{group.count}</small>
                    </span>
                  </article>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function buildResolvedRegionsByAddress(people: Person[], resolvedRegions: Record<string, string>) {
  const regionsByAddress = new Map<string, string>();

  people.forEach((person) => {
    const community = getAutonomousCommunity(person) ?? getCommunityByCode(resolvedRegions[person.id]);
    if (community) {
      getBirthPlaceRegionKeys(person).forEach((key) => regionsByAddress.set(key, community.code));
    }
  });

  return regionsByAddress;
}

function getCommunityForPerson(
  person: Person,
  resolvedRegions: Record<string, string>,
  resolvedRegionsByAddress: Map<string, string>
) {
  const directCommunity = getAutonomousCommunity(person) ?? getCommunityByCode(resolvedRegions[person.id]);
  if (directCommunity) return directCommunity;

  const cachedCommunity = getKnownAutonomousCommunityForPerson(person);
  if (cachedCommunity) return cachedCommunity;

  const sharedCode = getBirthPlaceRegionKeys(person)
    .map((key) => resolvedRegionsByAddress.get(key))
    .find(Boolean);
  return getCommunityByCode(sharedCode) ?? getCountryRegionForPerson(person);
}

function getCountryRegionForPerson(person: Person): AutonomousCommunity | null {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const country = place.country || person.birthCountry;
  if (!country || isSpainCountryName(country)) return null;

  const cleanCountry = cleanCountryName(country) || country.trim();
  if (!cleanCountry) return null;

  return {
    code: `country-${normalizePlaceName(cleanCountry).replace(/\s+/g, "-")}`,
    name: cleanCountry,
    flagUrl: countryFlagUrl(cleanCountry),
    keywords: [cleanCountry]
  };
}

function getBirthPlaceRegionKeys(person: Person) {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  return uniqueIds(
    [
      getBirthAddress(person),
      place.city,
      [place.city, place.country].filter(Boolean).join(", "),
      person.birthCity,
      person.birthPlace
    ]
      .map((value) => normalizePlaceName(value))
      .filter(Boolean)
  );
}

function groupGenerationByCommunity(
  people: Person[],
  resolvedRegions: Record<string, string>,
  resolvedRegionsByAddress: Map<string, string>
) {
  const groups = new Map<string, { community: AutonomousCommunity | null; count: number }>();

  people.forEach((person) => {
    const community = getCommunityForPerson(person, resolvedRegions, resolvedRegionsByAddress);
    const key = community?.code ?? "unknown";
    const current = groups.get(key);

    if (current) {
      current.count += 1;
      return;
    }

    groups.set(key, { community, count: 1 });
  });

  return [...groups.values()].sort((first, second) => {
    if (!first.community) return 1;
    if (!second.community) return -1;
    return first.community.name.localeCompare(second.community.name);
  });
}

function CommunityFlag({ community }: { community: AutonomousCommunity | null }) {
  if (!community || !community.flagUrl) {
    return <span className="regional-flag flag-unknown" aria-hidden="true" />;
  }

  return (
    <span className="regional-flag" aria-hidden="true">
      <img src={community.flagUrl} alt="" loading="lazy" />
    </span>
  );
}

interface CalendarBirthday {
  person: Person;
  day: number;
  month: number;
}

interface CalendarSaintDay {
  person: Person;
  name: string;
  day: number;
  month: number;
}

interface CalendarRelationshipAnniversary {
  relationship: Relationship;
  label: string;
  day: number;
  month: number;
}

interface FamilyTimelineEvent {
  id: string;
  date: Date;
  label: string;
  detail: string;
  type: "birth" | "death" | "relationship";
}

function ConditionsCatalogView({
  people,
  conditions,
  categories,
  t,
  onSelectPerson,
  onUpdateCondition,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onEnrichCondition,
  embedded = false
}: {
  people: Person[];
  conditions: ClinicalCondition[];
  categories: ClinicalConditionCategory[];
  t: Record<string, string>;
  onSelectPerson: (person: Person) => void;
  onUpdateCondition: (conditionId: string, patch: Partial<ClinicalCondition>) => void;
  onAddCategory: () => void;
  onUpdateCategory: (categoryId: string, patch: Partial<ClinicalConditionCategory>) => void;
  onDeleteCategory: (categoryId: string) => void;
  onEnrichCondition: (conditionId: string) => Promise<void>;
  embedded?: boolean;
}) {
  const [editingConditionId, setEditingConditionId] = useState("");
  const [loadingConditionId, setLoadingConditionId] = useState("");
  const sortedConditions = [...conditions].sort(compareClinicalConditions);

  async function enrichCondition(conditionId: string) {
    setLoadingConditionId(conditionId);
    try {
      await onEnrichCondition(conditionId);
    } finally {
      setLoadingConditionId("");
    }
  }

  return (
    <section className={embedded ? "conditions-view embedded" : "conditions-view"}>
      {!embedded ? (
        <header className="people-view-header">
          <h1>{t.conditions}</h1>
        </header>
      ) : null}
      <div className="conditions-workspace">
        <section className="condition-category-manager">
          <div>
            <strong>{t.clinicalCategories}</strong>
            <p>{t.clinicalCategoriesHint}</p>
          </div>
          <div className="condition-category-list">
            {categories.map((category) => (
              <label className="condition-category-item" key={category.id}>
                <input
                  aria-label={t.categoryColor}
                  type="color"
                  value={category.color}
                  onChange={(event) => onUpdateCategory(category.id, { color: event.target.value })}
                />
                <input
                  aria-label={t.categoryName}
                  value={category.name}
                  onChange={(event) => onUpdateCategory(category.id, { name: event.target.value })}
                />
                <button type="button" title={t.deleteCategory} onClick={() => onDeleteCategory(category.id)}>
                  <Trash2 size={15} />
                </button>
              </label>
            ))}
            <button className="secondary-action compact-action" type="button" onClick={onAddCategory}>
              <Plus size={15} />
              <span>{t.addCategory}</span>
            </button>
          </div>
        </section>
        {sortedConditions.length === 0 ? (
          <div className="empty-state conditions-empty-state">
            <HeartPulse size={34} />
            <h2>{t.noConditionsCatalog}</h2>
            <p>{t.noConditionsCatalogHint}</p>
          </div>
        ) : (
          <div className="conditions-catalog-grid">
            {sortedConditions.map((condition) => {
              const affectedPeople = getAffectedPeople(people, condition.id);
              const isEditing = editingConditionId === condition.id;
              const category = categories.find((item) => item.id === condition.categoryId);
              return (
                <article className="condition-catalog-card" key={condition.id}>
                  <header>
                    <div>
                      <h2 className="condition-card-title">
                        <span
                          className="condition-category-dot"
                          style={{ backgroundColor: category?.color ?? "rgba(83, 97, 91, 0.28)" }}
                          aria-hidden="true"
                        />
                        <span>{condition.name}</span>
                      </h2>
                      <p>{t.affectedPeopleCount.replace("{count}", String(affectedPeople.length))}</p>
                    </div>
                    <div className="condition-header-actions">
                      <button
                        className="condition-header-action"
                        type="button"
                        title={loadingConditionId === condition.id ? t.loadingClinicalConditionInfo : t.fetchClinicalConditionInfo}
                        aria-label={loadingConditionId === condition.id ? t.loadingClinicalConditionInfo : t.fetchClinicalConditionInfo}
                        onClick={() => enrichCondition(condition.id)}
                        disabled={loadingConditionId === condition.id}
                      >
                        <RefreshCw size={15} />
                      </button>
                      <button
                        className="condition-header-action"
                        type="button"
                        title={isEditing ? t.close : t.editConditionInfo}
                        aria-label={isEditing ? t.close : t.editConditionInfo}
                        onClick={() => setEditingConditionId(isEditing ? "" : condition.id)}
                      >
                        <Pencil size={15} />
                      </button>
                      {condition.sourceUrl ? (
                        <a className="condition-source-badge" href={condition.sourceUrl} target="_blank" rel="noreferrer">
                          <SquareArrowOutUpRight size={15} />
                          <span>{condition.sourceName || t.openSource}</span>
                        </a>
                      ) : null}
                    </div>
                  </header>
                  {isEditing ? (
                    <div className="condition-edit-fields">
                      <label>
                        <span>{t.clinicalCategory}</span>
                        <select
                          value={condition.categoryId ?? ""}
                          onChange={(event) => onUpdateCondition(condition.id, { categoryId: event.target.value || undefined })}
                        >
                          <option value="">{t.noCategory}</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{t.symptoms}</span>
                        <textarea
                          value={condition.symptoms ?? ""}
                          onChange={(event) => onUpdateCondition(condition.id, { symptoms: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>{t.description}</span>
                        <textarea
                          value={condition.description ?? ""}
                          onChange={(event) => onUpdateCondition(condition.id, { description: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>{t.notes}</span>
                        <textarea
                          value={condition.notes ?? ""}
                          onChange={(event) => onUpdateCondition(condition.id, { notes: event.target.value })}
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      {condition.symptoms ? (
                        <ConditionSummarySection title={t.symptoms} text={condition.symptoms} />
                      ) : null}
                      {condition.description ? (
                        <ConditionSummarySection title={t.description} text={condition.description} />
                      ) : null}
                      {condition.notes ? (
                        <ConditionSummarySection title={t.notes} text={condition.notes} />
                      ) : null}
                    </>
                  )}
                  <div className="affected-people condition-affected-people">
                    {affectedPeople.length === 0 ? (
                      <span>{t.emptyValue}</span>
                    ) : (
                      affectedPeople.map((person) => (
                        <button type="button" key={person.id} onClick={() => onSelectPerson(person)}>
                          {fullName(person) || t.person}
                        </button>
                      ))
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function ConditionSummarySection({ title, text }: { title: string; text: string }) {
  const paragraphs = text
    .split(/\n{1,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <section className="condition-summary-section">
      <strong>{title}</strong>
      <div className="condition-summary-text">
        {(paragraphs.length > 0 ? paragraphs : [text]).map((paragraph, index) => (
          <p key={`${title}-${index}`}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

interface GalleryDraftFace {
  photoId: string;
  personId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GalleryMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function GalleryUploadLocationModal({
  photos,
  t,
  onUpdatePhoto,
  onCancel,
  onConfirm
}: {
  photos: GalleryPhoto[];
  t: Record<string, string>;
  onUpdatePhoto: (photoId: string, patch: Partial<GalleryPhoto>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const firstPendingPhoto = photos.find((photo) => !hasGalleryPhotoCoordinates(photo));
  const [selectedPhotoId, setSelectedPhotoId] = useState(firstPendingPhoto?.id ?? photos[0]?.id ?? "");
  const selectedPhoto = photos.find((photo) => photo.id === selectedPhotoId) ?? photos[0];
  const [locationQuery, setLocationQuery] = useState(selectedPhoto?.location ?? "");
  const [locationStatus, setLocationStatus] = useState("");
  const allPhotosLocated = photos.every(hasGalleryPhotoCoordinates);

  useEffect(() => {
    if (!selectedPhoto) return;
    setLocationQuery(selectedPhoto.location ?? "");
    setLocationStatus("");
  }, [selectedPhoto?.id]);

  useEffect(() => {
    if (!selectedPhoto || hasGalleryPhotoCoordinates(selectedPhoto)) return;
    const nextPendingPhoto = photos.find((photo) => !hasGalleryPhotoCoordinates(photo));
    if (nextPendingPhoto && nextPendingPhoto.id !== selectedPhoto.id) {
      setSelectedPhotoId(nextPendingPhoto.id);
    }
  }, [photos, selectedPhoto]);

  async function searchLocation() {
    if (!selectedPhoto || !locationQuery.trim()) return;
    setLocationStatus(t.searchingLocation);
    try {
      const location = await geocodeAddress(locationQuery);
      if (!location?.coords) {
        setLocationStatus(t.locationNotFound);
        return;
      }
      onUpdatePhoto(selectedPhoto.id, {
        location: locationQuery.trim(),
        latitude: location.coords.lat,
        longitude: location.coords.lng
      });
      setLocationStatus(t.locationSelected);
    } catch {
      setLocationStatus(t.locationNotFound);
    }
  }

  async function pickLocation(latitude: number, longitude: number) {
    if (!selectedPhoto) return;
    setLocationStatus(t.searchingLocation);
    const location = await reverseGeocodeOpenStreetMap(latitude, longitude);
    onUpdatePhoto(selectedPhoto.id, {
      location,
      latitude,
      longitude
    });
    setLocationQuery(location);
    setLocationStatus(t.locationSelected);
  }

  if (!selectedPhoto) return null;

  return (
    <div className="modal-backdrop gallery-location-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="person-modal gallery-location-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{t.gallery}</span>
            <h2>{t.galleryUploadLocationTitle}</h2>
          </div>
          <button type="button" title={t.close} aria-label={t.close} onClick={onCancel}>
            <X size={20} />
          </button>
        </header>
        <p className="gallery-location-hint">{t.galleryUploadLocationHint}</p>
        <div className="gallery-location-layout">
          <aside className="gallery-upload-list">
            {photos.map((photo) => (
              <button
                className={photo.id === selectedPhoto.id ? "active" : ""}
                type="button"
                key={photo.id}
                onClick={() => setSelectedPhotoId(photo.id)}
              >
                <img src={photo.dataUrl} alt={photo.title || photo.fileName || t.galleryPhoto} />
                <span>
                  <strong>{photo.title || photo.fileName || t.galleryPhoto}</strong>
                  <small>{hasGalleryPhotoCoordinates(photo) ? t.locationSelected : t.locationPending}</small>
                </span>
              </button>
            ))}
          </aside>
          <div className="gallery-location-picker">
            <div className="gallery-location-photo">
              <img src={selectedPhoto.dataUrl} alt={selectedPhoto.title || selectedPhoto.fileName || t.galleryPhoto} />
            </div>
            <label className="search-box">
              <MapPinned size={17} />
              <input
                value={locationQuery}
                placeholder={t.searchLocationPlaceholder}
                onChange={(event) => setLocationQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchLocation();
                  }
                }}
              />
              <button type="button" onClick={() => void searchLocation()}>
                {t.search}
              </button>
            </label>
            <PhotoLocationPickerMap photo={selectedPhoto} t={t} onPickLocation={pickLocation} />
            {locationStatus ? <small>{locationStatus}</small> : null}
          </div>
        </div>
        <footer className="modal-footer">
          <button type="button" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="primary-action" type="button" disabled={!allPhotosLocated} onClick={onConfirm}>
            {t.importLocatedPhotos}
          </button>
        </footer>
      </section>
    </div>
  );
}

function PhotoLocationPickerMap({
  photo,
  t,
  onPickLocation
}: {
  photo: GalleryPhoto;
  t: Record<string, string>;
  onPickLocation: (latitude: number, longitude: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const initialCenter: [number, number] = hasGalleryPhotoCoordinates(photo) ? [photo.latitude, photo.longitude] : [40.42, -3.7];
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: true }).setView(
      initialCenter,
      hasGalleryPhotoCoordinates(photo) ? 13 : 5
    );

    addSoftBaseMapLayer(map);

    let marker = hasGalleryPhotoCoordinates(photo)
      ? L.circleMarker(initialCenter, {
          radius: 8,
          color: "#075f58",
          fillColor: "#087d72",
          fillOpacity: 0.9,
          weight: 2
        }).addTo(map)
      : null;

    map.on("click", (event) => {
      const nextCenter: [number, number] = [event.latlng.lat, event.latlng.lng];
      if (marker) {
        marker.setLatLng(nextCenter);
      } else {
        marker = L.circleMarker(nextCenter, {
          radius: 8,
          color: "#075f58",
          fillColor: "#087d72",
          fillOpacity: 0.9,
          weight: 2
        }).addTo(map);
      }
      onPickLocation(event.latlng.lat, event.latlng.lng);
    });

    window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
    };
  }, [photo.id, photo.latitude, photo.longitude, onPickLocation]);

  return (
    <div className="photo-location-map">
      <div ref={mapRef} />
      <span>{t.clickMapToSetLocation}</span>
    </div>
  );
}

function GalleryLocationMapFilter({
  photos,
  bounds,
  t,
  onBoundsChange
}: {
  photos: GalleryPhoto[];
  bounds: GalleryMapBounds | null;
  t: Record<string, string>;
  onBoundsChange: (bounds: GalleryMapBounds | null) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView([40.42, -3.7], 5);

    addSoftBaseMapLayer(map);

    const markerLayer = L.layerGroup().addTo(map);
    const leafletBounds = L.latLngBounds([]);

    photos.forEach((photo) => {
      if (!hasGalleryPhotoCoordinates(photo)) return;
      const latLng: [number, number] = [photo.latitude, photo.longitude];
      leafletBounds.extend(latLng);
      L.circleMarker(latLng, {
        radius: 7,
        color: "#075f58",
        fillColor: "#087d72",
        fillOpacity: 0.82,
        weight: 2
      })
        .bindTooltip(photo.title || photo.fileName || t.galleryPhoto)
        .addTo(markerLayer);
    });

    if (leafletBounds.isValid()) {
      map.fitBounds(leafletBounds.pad(0.22), { maxZoom: 12 });
    }

    const updateBounds = () => {
      const currentBounds = map.getBounds();
      onBoundsChange({
        north: currentBounds.getNorth(),
        south: currentBounds.getSouth(),
        east: currentBounds.getEast(),
        west: currentBounds.getWest()
      });
    };

    map.on("moveend zoomend", updateBounds);
    window.setTimeout(() => {
      map.invalidateSize();
    }, 0);

    return () => {
      map.off("moveend zoomend", updateBounds);
      map.remove();
    };
  }, [photos, t.galleryPhoto, onBoundsChange]);

  return (
    <div className="gallery-map-filter">
      <div className="gallery-map-filter-header">
        <span>{t.galleryMapFilterHint}</span>
      </div>
      {photos.length === 0 ? (
        <div className="gallery-map-empty">
          <MapPinned size={22} />
          <span>{t.galleryMapNoLocatedPhotos}</span>
        </div>
      ) : (
        <div className="gallery-map-filter-canvas" ref={mapRef} />
      )}
    </div>
  );
}

function GalleryMomentRangeFilter({
  bounds,
  range,
  t,
  onChange
}: {
  bounds: { min: number; max: number } | null;
  range: { start: number; end: number } | null;
  t: Record<string, string>;
  onChange: (range: { start: number; end: number }) => void;
}) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [activeHandle, setActiveHandle] = useState<"start" | "end" | null>(null);

  if (!bounds) {
    return (
      <div className="gallery-range-filter empty">
        <CalendarDays size={18} />
        <span>{t.galleryNoDatedPhotos}</span>
      </div>
    );
  }

  const yearBounds = bounds;
  const currentRange = range ?? { start: yearBounds.min, end: yearBounds.max };
  const span = Math.max(1, yearBounds.max - yearBounds.min);
  const startPercent = ((currentRange.start - yearBounds.min) / span) * 100;
  const endPercent = ((currentRange.end - yearBounds.min) / span) * 100;

  function updateStart(value: number) {
    onChange({ start: Math.min(value, currentRange.end), end: currentRange.end });
  }

  function updateEnd(value: number) {
    onChange({ start: currentRange.start, end: Math.max(value, currentRange.start) });
  }

  function getYearFromPointer(event: React.PointerEvent<HTMLElement>) {
    const slider = sliderRef.current;
    if (!slider) return currentRange.start;
    const rect = slider.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(yearBounds.min + Math.min(1, Math.max(0, ratio)) * (yearBounds.max - yearBounds.min));
  }

  function moveHandle(handle: "start" | "end", event: React.PointerEvent<HTMLElement>) {
    const year = getYearFromPointer(event);
    if (handle === "start") {
      updateStart(year);
    } else {
      updateEnd(year);
    }
  }

  function startDragging(handle: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveHandle(handle);
    moveHandle(handle, event);
  }

  function startDraggingFromTrack(event: React.PointerEvent<HTMLDivElement>) {
    const year = getYearFromPointer(event);
    const handle = Math.abs(year - currentRange.start) <= Math.abs(year - currentRange.end) ? "start" : "end";
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveHandle(handle);
    moveHandle(handle, event);
  }

  return (
    <div className="gallery-range-filter">
      <div className="gallery-range-header">
        <span>{`${t.galleryMomentFilter} (${currentRange.start}-${currentRange.end})`}</span>
      </div>
      <div
        className="gallery-range-slider"
        ref={sliderRef}
        style={{ "--range-start": `${startPercent}%`, "--range-end": `${endPercent}%` } as CSSProperties}
        onPointerDown={startDraggingFromTrack}
        onPointerMove={(event) => {
          if (activeHandle) moveHandle(activeHandle, event);
        }}
        onPointerUp={() => setActiveHandle(null)}
        onPointerCancel={() => setActiveHandle(null)}
      >
        <button
          className="gallery-range-handle"
          type="button"
          style={{ left: `${startPercent}%` }}
          aria-label={`${t.galleryMomentFilter} ${currentRange.start}`}
          onPointerDown={(event) => startDragging("start", event)}
        />
        <button
          className="gallery-range-handle"
          type="button"
          style={{ left: `${endPercent}%` }}
          aria-label={`${t.galleryMomentFilter} ${currentRange.end}`}
          onPointerDown={(event) => startDragging("end", event)}
        />
      </div>
      <div className="gallery-range-years">
        <span>{yearBounds.min}</span>
        <span>{yearBounds.max}</span>
      </div>
    </div>
  );
}

function GalleryView({
  people,
  photos,
  t,
  initialPersonId,
  onAddFiles,
  onUpdatePhoto,
  onResolvePhotoLocation,
  onResolveMissingPhotoLocations,
  onDeletePhoto,
  onSetPersonPhoto
}: {
  people: Person[];
  photos: GalleryPhoto[];
  t: Record<string, string>;
  initialPersonId: string;
  onAddFiles: (files: FileList | File[]) => void;
  onUpdatePhoto: (photoId: string, patch: Partial<GalleryPhoto>) => void;
  onResolvePhotoLocation: (photoId: string, locationText?: string) => void;
  onResolveMissingPhotoLocations: () => void;
  onDeletePhoto: (photoId: string) => void;
  onSetPersonPhoto: (photo: GalleryPhoto, personId: string) => void;
}) {
  const [personFilter, setPersonFilter] = useState("");
  const [personSearchQuery, setPersonSearchQuery] = useState("");
  const [locationBounds, setLocationBounds] = useState<GalleryMapBounds | null>(null);
  const [momentRange, setMomentRange] = useState<{ start: number; end: number } | null>(null);
  const [activeGalleryFilter, setActiveGalleryFilter] = useState<"people" | "location" | "moment" | "">("");
  const [facePersonByPhoto, setFacePersonByPhoto] = useState<Record<string, string>>({});
  const [draftFace, setDraftFace] = useState<GalleryDraftFace | null>(null);
  const [editingPhotoId, setEditingPhotoId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedPersonIds = personFilter.split(",").map((id) => id.trim()).filter(Boolean);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const selectedFilterPeople = selectedPersonIds
    .map((personId) => peopleById.get(personId))
    .filter((person): person is Person => Boolean(person));
  const visibleFilterPeople = people
    .filter((person) => {
      const query = normalizePlaceName(personSearchQuery);
      if (!query) return true;
      return normalizePlaceName(fullName(person)).includes(query);
    })
    .slice(0, 10);
  const editingPhoto = photos.find((photo) => photo.id === editingPhotoId) ?? null;
  const locatedPhotos = useMemo(() => photos.filter(hasGalleryPhotoCoordinates), [photos]);
  const galleryYearBounds = useMemo(() => getGalleryYearBounds(photos), [photos]);
  const isLocationFilterActive = activeGalleryFilter === "location" && Boolean(locationBounds);
  const isMomentFilterActive =
    activeGalleryFilter === "moment" &&
    Boolean(momentRange) &&
    Boolean(galleryYearBounds) &&
    (momentRange?.start !== galleryYearBounds?.min || momentRange?.end !== galleryYearBounds?.max);
  const hasGalleryFilters = selectedPersonIds.length > 0 || isLocationFilterActive || isMomentFilterActive;
  const filteredPhotos = photos
    .filter((photo) => {
      if (selectedPersonIds.length === 0) return true;
      return selectedPersonIds.every((personId) => photo.personIds.includes(personId));
    })
    .filter((photo) => {
      if (!isLocationFilterActive || !locationBounds) return true;
      return isGalleryPhotoInsideBounds(photo, locationBounds);
    })
    .filter((photo) => {
      if (!isMomentFilterActive || !momentRange) return true;
      const year = extractYear(photo.takenAt);
      if (year === null) return false;
      return year >= momentRange.start && year <= momentRange.end;
    })
    .sort(compareGalleryPhotos);

  useEffect(() => {
    if (!initialPersonId) return;
    setPersonFilter(initialPersonId);
    setActiveGalleryFilter("people");
  }, [initialPersonId]);

  useEffect(() => {
    if (activeGalleryFilter === "location") {
      onResolveMissingPhotoLocations();
    }
  }, [activeGalleryFilter]);

  useEffect(() => {
    if (activeGalleryFilter !== "moment" || !galleryYearBounds) return;
    setMomentRange((currentRange) => {
      if (
        currentRange &&
        currentRange.start >= galleryYearBounds.min &&
        currentRange.end <= galleryYearBounds.max &&
        currentRange.start <= currentRange.end
      ) {
        return currentRange;
      }
      return { start: galleryYearBounds.min, end: galleryYearBounds.max };
    });
  }, [activeGalleryFilter, galleryYearBounds]);

  function togglePersonFilter(personId: string) {
    const nextIds = selectedPersonIds.includes(personId)
      ? selectedPersonIds.filter((id) => id !== personId)
      : [...selectedPersonIds, personId];
    setPersonFilter(nextIds.join(","));
  }

  function clearGalleryFilters() {
    setPersonFilter("");
    setPersonSearchQuery("");
    setLocationBounds(null);
    setMomentRange(galleryYearBounds ? { start: galleryYearBounds.min, end: galleryYearBounds.max } : null);
  }

  function togglePhotoPerson(photo: GalleryPhoto, personId: string) {
    const isLinked = photo.personIds.includes(personId);
    const personIds = isLinked ? photo.personIds.filter((id) => id !== personId) : [...photo.personIds, personId];
    const faceRegions = isLinked
      ? (photo.faceRegions ?? []).filter((region) => region.personId !== personId)
      : photo.faceRegions;
    onUpdatePhoto(photo.id, { personIds, faceRegions });
  }

  function selectFacePerson(photoId: string, personId: string) {
    setFacePersonByPhoto((current) => ({ ...current, [photoId]: personId }));
  }

  function startFaceDraft(photo: GalleryPhoto, event: React.PointerEvent<HTMLElement>) {
    const personId = facePersonByPhoto[photo.id];
    if (!personId) return;

    const point = getGalleryPointerPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftFace({
      photoId: photo.id,
      personId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0
    });
  }

  function updateFaceDraft(photo: GalleryPhoto, event: React.PointerEvent<HTMLElement>) {
    if (!draftFace || draftFace.photoId !== photo.id) return;

    const point = getGalleryPointerPoint(event);
    setDraftFace({
      ...draftFace,
      x: Math.min(draftFace.startX, point.x),
      y: Math.min(draftFace.startY, point.y),
      width: Math.abs(point.x - draftFace.startX),
      height: Math.abs(point.y - draftFace.startY)
    });
  }

  function finishFaceDraft(photo: GalleryPhoto, event: React.PointerEvent<HTMLElement>) {
    if (!draftFace || draftFace.photoId !== photo.id) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    const nextDraft = { ...draftFace };
    setDraftFace(null);

    if (nextDraft.width < 3 || nextDraft.height < 3) return;

    const nextRegion: GalleryFaceRegion = {
      id: createId("face"),
      personId: nextDraft.personId,
      x: clampPercent(nextDraft.x),
      y: clampPercent(nextDraft.y),
      width: clampPercent(nextDraft.width),
      height: clampPercent(nextDraft.height)
    };
    const faceRegions = [...(photo.faceRegions ?? []).filter((region) => region.personId !== nextDraft.personId), nextRegion];
    const personIds = photo.personIds.includes(nextDraft.personId) ? photo.personIds : [...photo.personIds, nextDraft.personId];

    onUpdatePhoto(photo.id, { faceRegions, personIds });
  }

  function removeFaceRegion(photo: GalleryPhoto, regionId: string) {
    onUpdatePhoto(photo.id, { faceRegions: (photo.faceRegions ?? []).filter((region) => region.id !== regionId) });
  }

  function renderFaceRegions(photo: GalleryPhoto) {
    const currentDraft = draftFace?.photoId === photo.id ? draftFace : null;

    return (
      <>
        {(photo.faceRegions ?? []).map((region) => {
          const person = peopleById.get(region.personId);
          return (
            <span
              className="gallery-face-region"
              key={region.id}
              style={{
                left: `${region.x}%`,
                top: `${region.y}%`,
                width: `${region.width}%`,
                height: `${region.height}%`
              }}
              title={person ? fullName(person) : t.person}
            >
              {person ? getPersonInitials(person) : ""}
            </span>
          );
        })}
        {currentDraft ? (
          <span
            className="gallery-face-region draft"
            style={{
              left: `${currentDraft.x}%`,
              top: `${currentDraft.y}%`,
              width: `${currentDraft.width}%`,
              height: `${currentDraft.height}%`
            }}
          />
        ) : null}
      </>
    );
  }

  function renderFaceList(photo: GalleryPhoto) {
    return (photo.faceRegions ?? []).length > 0 ? (
      <div className="gallery-face-list">
        {(photo.faceRegions ?? []).map((region) => {
          const person = peopleById.get(region.personId);
          return (
            <div className="gallery-face-item" key={region.id}>
              <span>{person ? fullName(person) : t.person}</span>
              <button type="button" onClick={() => onSetPersonPhoto(photo, region.personId)}>
                <ImagePlus size={15} />
                <span>{t.useAsProfilePhoto}</span>
              </button>
              <button type="button" title={t.removeFaceMark} onClick={() => removeFaceRegion(photo, region.id)}>
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    ) : null;
  }

  return (
    <>
    <section className="gallery-view">
      <header className="people-view-header">
        <h1>{t.gallery}</h1>
        <div className="gallery-header-actions">
          <button
            className={`secondary-action compact-action ${activeGalleryFilter === "people" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveGalleryFilter(activeGalleryFilter === "people" ? "" : "people")}
          >
            <Users size={16} />
            <span>{t.galleryFilterPeople}</span>
          </button>
          <button
            className={`secondary-action compact-action ${activeGalleryFilter === "location" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveGalleryFilter(activeGalleryFilter === "location" ? "" : "location")}
          >
            <MapPinned size={16} />
            <span>{t.galleryFilterLocation}</span>
          </button>
          <button
            className={`secondary-action compact-action ${activeGalleryFilter === "moment" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveGalleryFilter(activeGalleryFilter === "moment" ? "" : "moment")}
          >
            <CalendarDays size={16} />
            <span>{t.galleryFilterMoment}</span>
          </button>
          <button className="primary-action compact-action" type="button" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus size={17} />
            <span>{t.addPhotos}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) onAddFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </header>

      {activeGalleryFilter ? (
        <section className="gallery-filter-strip">
          {activeGalleryFilter === "location" ? (
            <GalleryLocationMapFilter
              photos={locatedPhotos}
              t={t}
              bounds={locationBounds}
              onBoundsChange={setLocationBounds}
            />
          ) : null}
          {activeGalleryFilter === "moment" ? (
            <GalleryMomentRangeFilter
              bounds={galleryYearBounds}
              range={momentRange}
              t={t}
              onChange={setMomentRange}
            />
          ) : null}
          {activeGalleryFilter === "people" ? (
            <div className="gallery-person-filter-panel">
              <label className="search-box gallery-person-search">
                <Search size={17} />
                <input
                  value={personSearchQuery}
                  placeholder={t.searchPlaceholder}
                  onChange={(event) => setPersonSearchQuery(event.target.value)}
                />
              </label>
              {personSearchQuery.trim() ? (
                <div className="gallery-person-filter-results">
                  {visibleFilterPeople.map((person) => (
                    <button
                      key={person.id}
                      className={selectedPersonIds.includes(person.id) ? "active" : ""}
                      type="button"
                      onClick={() => togglePersonFilter(person.id)}
                    >
                      {fullName(person) || t.person}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedFilterPeople.length > 0 ? (
                <div className="gallery-person-filter-selected">
                  {selectedFilterPeople.map((person) => (
                    <button key={person.id} type="button" onClick={() => togglePersonFilter(person.id)}>
                      <span>{fullName(person) || t.person}</span>
                      <X size={13} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

        <div className="gallery-grid">
          {filteredPhotos.length === 0 ? (
            <div className="empty-state">
              <Image size={34} />
              <h2>{photos.length > 0 && hasGalleryFilters ? t.noGalleryFilterResults : t.noGalleryPhotos}</h2>
              <p>{photos.length > 0 && hasGalleryFilters ? t.noGalleryFilterResultsHint : t.noGalleryPhotosHint}</p>
              {photos.length > 0 && hasGalleryFilters ? (
                <button className="secondary-action compact-action" type="button" onClick={clearGalleryFilters}>
                  <X size={16} />
                  <span>{t.clearFilters}</span>
                </button>
              ) : null}
            </div>
          ) : (
            filteredPhotos.map((photo) => (
              <article className="gallery-card" key={photo.id}>
                <button className="gallery-image-frame" type="button" onClick={() => setEditingPhotoId(photo.id)}>
                  <img
                    src={photo.dataUrl}
                    alt={photo.title || photo.fileName || t.galleryPhoto}
                    draggable={false}
                    style={{ objectPosition: getGalleryThumbnailFocus(photo) }}
                  />
                  <span className="gallery-edit-overlay" aria-hidden="true">
                    <Pencil size={18} />
                  </span>
                </button>
              </article>
            ))
          )}
        </div>
    </section>
    {editingPhoto ? (
      <div className="modal-backdrop gallery-editor-backdrop" role="presentation" onMouseDown={() => setEditingPhotoId("")}>
        <section className="person-modal gallery-editor-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
          <header className="modal-header">
            <div>
              <span>{t.photoFaceEditor}</span>
              <h2>{editingPhoto.title || editingPhoto.fileName || t.galleryPhoto}</h2>
            </div>
            <button type="button" title={t.close} aria-label={t.close} onClick={() => setEditingPhotoId("")}>
              <X size={20} />
            </button>
          </header>
          <div className="gallery-editor-layout">
            <div
              className={`gallery-editor-image-frame ${facePersonByPhoto[editingPhoto.id] ? "marking" : ""}`}
              onPointerDown={(event) => startFaceDraft(editingPhoto, event)}
              onPointerMove={(event) => updateFaceDraft(editingPhoto, event)}
              onPointerUp={(event) => finishFaceDraft(editingPhoto, event)}
              onPointerCancel={() => setDraftFace(null)}
            >
              <img src={editingPhoto.dataUrl} alt={editingPhoto.title || editingPhoto.fileName || t.galleryPhoto} draggable={false} />
              {renderFaceRegions(editingPhoto)}
            </div>
            <aside className="gallery-editor-panel">
              <label>
                <span>{t.galleryPhotoTitle}</span>
                <input
                  value={editingPhoto.title ?? ""}
                  onChange={(event) => onUpdatePhoto(editingPhoto.id, { title: event.target.value })}
                />
              </label>
              <div className="editor-row">
                <label>
                  <span>{t.photoDate}</span>
                  <input
                    value={editingPhoto.takenAt ?? ""}
                    placeholder="DD/MM/AAAA"
                    onChange={(event) => onUpdatePhoto(editingPhoto.id, { takenAt: event.target.value })}
                  />
                </label>
                <label>
                  <span>{t.place}</span>
                  <input
                    value={editingPhoto.location ?? ""}
                    onBlur={(event) => onResolvePhotoLocation(editingPhoto.id, event.target.value)}
                    onChange={(event) =>
                      onUpdatePhoto(editingPhoto.id, {
                        location: event.target.value,
                        latitude: undefined,
                        longitude: undefined
                      })
                    }
                  />
                </label>
              </div>
              <div className="gallery-face-tools">
                <label>
                  <span>{t.markFace}</span>
                  <select
                    value={facePersonByPhoto[editingPhoto.id] ?? ""}
                    onChange={(event) => selectFacePerson(editingPhoto.id, event.target.value)}
                  >
                    <option value="">{t.choosePersonForFace}</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {fullName(person) || t.person}
                      </option>
                    ))}
                  </select>
                </label>
                <small>{t.dragFaceHint}</small>
              </div>
              {renderFaceList(editingPhoto)}
              <textarea
                value={editingPhoto.notes ?? ""}
                placeholder={t.notes}
                onChange={(event) => onUpdatePhoto(editingPhoto.id, { notes: event.target.value })}
              />
            </aside>
          </div>
        </section>
      </div>
    ) : null}
    </>
  );
}

function BirthdayCalendarView({
  people,
  relationships,
  photos,
  worldHistoryEvents,
  selectedId,
  t,
  showSaintDays,
  onSelect,
  onOpenStarMap,
  onSaveWorldHistoryEvents
}: {
  people: Person[];
  relationships: Relationship[];
  photos: GalleryPhoto[];
  worldHistoryEvents: Record<string, WorldHistoryEntry[]>;
  selectedId: string;
  t: Record<string, string>;
  showSaintDays: boolean;
  onSelect: (person: Person) => void;
  onOpenStarMap: (person: Person) => void;
  onSaveWorldHistoryEvents: (cacheKey: string, entries: WorldHistoryEntry[]) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [calendarMode, setCalendarMode] = useState<"calendar" | "history">("calendar");
  const [showBirthdayMarkers, setShowBirthdayMarkers] = useState(true);
  const [showSaintMarkers, setShowSaintMarkers] = useState(showSaintDays);
  const [showRelationshipMarkers, setShowRelationshipMarkers] = useState(true);
  useEffect(() => {
    if (!showSaintDays) setShowSaintMarkers(false);
  }, [showSaintDays]);
  const birthdays = useMemo(
    () =>
      people
        .map((person) => {
          const birthday = parseBirthday(person.birthDate);
          return birthday ? { person, ...birthday } : null;
        })
        .filter((birthday): birthday is CalendarBirthday => Boolean(birthday)),
    [people]
  );
  const birthdaysByDate = useMemo(() => {
    const groups = new Map<string, CalendarBirthday[]>();
    birthdays.forEach((birthday) => {
      const key = `${birthday.month}-${birthday.day}`;
      const group = groups.get(key) ?? [];
      group.push(birthday);
      groups.set(key, group);
    });
    return groups;
  }, [birthdays]);
  const saintsByDate = useMemo(() => {
    const groups = new Map<string, CalendarSaintDay[]>();
    if (!showSaintDays || !showSaintMarkers) return groups;

    people.forEach((person) => {
      const saintDate = getSaintDateForPerson(person);
      if (!saintDate) return;

      const key = `${saintDate.month}-${saintDate.day}`;
      const group = groups.get(key) ?? [];
      group.push({
        person,
        name: fullName(person) || person.givenName || t.person,
        ...saintDate
      });
      groups.set(key, group);
    });

    return groups;
  }, [people, showSaintDays, showSaintMarkers, t]);
  const relationshipAnniversariesByDate = useMemo(() => {
    const groups = new Map<string, CalendarRelationshipAnniversary[]>();
    if (!showRelationshipMarkers) return groups;

    const peopleById = new Map(people.map((person) => [person.id, person]));
    relationships
      .filter((relationship) => ["partner", "spouse", "former_spouse"].includes(relationship.kind))
      .forEach((relationship) => {
        const startDate = parseBirthday(relationship.startDate);
        if (!startDate) return;

        const firstPerson = peopleById.get(relationship.fromPersonId);
        const secondPerson = peopleById.get(relationship.toPersonId);
        const firstName = firstPerson ? fullName(firstPerson) || t.person : t.person;
        const secondName = secondPerson ? fullName(secondPerson) || t.person : t.person;
        const key = `${startDate.month}-${startDate.day}`;
        const group = groups.get(key) ?? [];
        group.push({
          relationship,
          label: `${firstName} · ${secondName}`,
          ...startDate
        });
        groups.set(key, group);
      });
    return groups;
  }, [people, relationships, showRelationshipMarkers, t]);

  return (
    <section className="calendar-view">
      <header className="people-view-header">
        <h1>{t.calendar}</h1>
        <div className="view-actions">
          <button
            className={calendarMode === "calendar" ? "active" : ""}
            type="button"
            onClick={() => setCalendarMode("calendar")}
          >
            <CalendarDays size={15} />
            <span>{t.calendar}</span>
          </button>
          <button
            className={calendarMode === "history" ? "active" : ""}
            type="button"
            onClick={() => setCalendarMode("history")}
          >
            <Hourglass size={15} />
            <span>{t.history}</span>
          </button>
        </div>
      </header>
      {calendarMode === "history" ? (
        <FamilyHistoryTimeline
          people={people}
          relationships={relationships}
          photos={photos}
          worldHistoryEvents={worldHistoryEvents}
          t={t}
          onSaveWorldHistoryEvents={onSaveWorldHistoryEvents}
        />
      ) : (
        <>
      <div className="birthday-calendar">
        {Array.from({ length: 12 }, (_, monthIndex) => (
          <section className="calendar-month" key={monthIndex}>
            <header>
              <h2>{getMonthName(monthIndex, t)}</h2>
            </header>
            <div className="calendar-weekdays" aria-hidden="true">
              {getWeekdayLabels(t).map((weekday) => (
                <span key={weekday}>{weekday}</span>
              ))}
            </div>
            <div className="calendar-days">
              {buildCalendarDays(currentYear, monthIndex).map((day, index) => {
                if (!day) return <span className="calendar-day empty" key={`empty-${index}`} />;

                const dayBirthdays = showBirthdayMarkers ? birthdaysByDate.get(`${monthIndex + 1}-${day}`) ?? [] : [];
                const daySaints = saintsByDate.get(`${monthIndex + 1}-${day}`) ?? [];
                const dayAnniversaries = relationshipAnniversariesByDate.get(`${monthIndex + 1}-${day}`) ?? [];
                const hasBirthdays = dayBirthdays.length > 0;
                const hasSaints = daySaints.length > 0;
                const hasAnniversaries = dayAnniversaries.length > 0;
                const birthdayNames = dayBirthdays.map(({ person }) => fullName(person) || t.person).join("\n");
                const saintNames = daySaints.map((saint) => saint.name).join("\n");
                const anniversaryNames = dayAnniversaries.map((anniversary) => anniversary.label).join("\n");
                const dayTitle = [
                  birthdayNames,
                  saintNames ? `${t.saintDays}:\n${saintNames}` : "",
                  anniversaryNames ? `${t.relationshipAnniversaries}:\n${anniversaryNames}` : ""
                ]
                  .filter(Boolean)
                  .join("\n\n");
                const firstBirthdayPerson = dayBirthdays[0]?.person;
                const firstSelectablePerson = firstBirthdayPerson ?? daySaints[0]?.person;
                const markerCount = Number(hasBirthdays) + Number(hasSaints) + Number(hasAnniversaries);
                const dayClassName = `calendar-day ${hasBirthdays ? "has-birthday" : ""} ${hasSaints ? "has-saint" : ""} ${
                  hasAnniversaries ? "has-anniversary" : ""
                } ${markerCount > 1 ? `has-${markerCount}-markers` : ""} ${
                  dayBirthdays.some(({ person }) => person.id === selectedId) ? "active" : ""
                }`;

                if (firstSelectablePerson) {
                  return (
                    <button
                      className={dayClassName}
                      key={day}
                      type="button"
                      title={dayTitle}
                      aria-label={dayTitle}
                      onClick={() =>
                        firstBirthdayPerson ? onOpenStarMap(firstBirthdayPerson) : onSelect(firstSelectablePerson)
                      }
                    >
                      <strong>{day}</strong>
                    </button>
                  );
                }

                return (
                  <span className={dayClassName} key={day} title={dayTitle} aria-label={dayTitle}>
                    <strong>{day}</strong>
                  </span>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="calendar-filter-controls" aria-label={t.calendar}>
        <button
          className={showBirthdayMarkers ? "active" : ""}
          type="button"
          title={t.birthdays}
          aria-label={t.birthdays}
          onClick={() => setShowBirthdayMarkers((current) => !current)}
        >
          <Cake size={18} />
        </button>
        <button
          className={showSaintMarkers ? "active" : ""}
          type="button"
          title={t.saintDays}
          aria-label={t.saintDays}
          disabled={!showSaintDays}
          onClick={() => setShowSaintMarkers((current) => !current)}
        >
          <FontAwesomeCrossIcon size={16} />
        </button>
        <button
          className={showRelationshipMarkers ? "active" : ""}
          type="button"
          title={t.relationshipAnniversaries}
          aria-label={t.relationshipAnniversaries}
          onClick={() => setShowRelationshipMarkers((current) => !current)}
        >
          <Heart size={17} />
        </button>
      </div>
        </>
      )}
    </section>
  );
}

function FamilyHistoryTimeline({
  people,
  relationships,
  photos,
  worldHistoryEvents,
  t,
  onSaveWorldHistoryEvents
}: {
  people: Person[];
  relationships: Relationship[];
  photos: GalleryPhoto[];
  worldHistoryEvents: Record<string, WorldHistoryEntry[]>;
  t: Record<string, string>;
  onSaveWorldHistoryEvents: (cacheKey: string, entries: WorldHistoryEntry[]) => void;
}) {
  const events = useMemo(() => buildFamilyTimelineEvents(people, relationships, t), [people, relationships, t]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedEvent = events[Math.min(selectedIndex, Math.max(0, events.length - 1))];
  const selectedCacheKey = selectedEvent ? buildWorldHistoryCacheKey(selectedEvent.date) : "";
  const selectedYear = selectedEvent?.date.getFullYear();
  const selectedWorldEvents = selectedCacheKey
    ? (worldHistoryEvents[selectedCacheKey] ?? []).filter((entry) =>
        isUsefulWorldHistoryEntry(entry) && entry.year === selectedYear
      )
    : [];
  const selectedPhotos = useMemo(
    () => (selectedEvent ? photos.filter((photo) => isGalleryPhotoOnDate(photo, selectedEvent.date)).sort(compareGalleryPhotos) : []),
    [photos, selectedEvent]
  );
  const [worldStatus, setWorldStatus] = useState("");
  const yearMarkers = useMemo(() => buildHistoryYearMarkers(events), [events]);

  useEffect(() => {
    if (selectedIndex >= events.length) setSelectedIndex(Math.max(0, events.length - 1));
  }, [events.length, selectedIndex]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorldEvents() {
      if (!selectedEvent || !selectedCacheKey) return;
      if (selectedWorldEvents.length > 0) {
        setWorldStatus("");
        return;
      }

      setWorldStatus(t.publicInfoSearching);
      try {
        const month = String(selectedEvent.date.getMonth() + 1).padStart(2, "0");
        const day = String(selectedEvent.date.getDate()).padStart(2, "0");
        const sourceUrl = `https://api.wikimedia.org/feed/v1/wikipedia/es/onthisday/all/${month}/${day}`;
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
        const data = (await response.json()) as {
          events?: Array<{ year?: number; text?: string; pages?: unknown[] }>;
          births?: Array<{ year?: number; text?: string; pages?: unknown[] }>;
        };
        const selectedYear = selectedEvent.date.getFullYear();
        const exactEvents = (data.events ?? [])
          .filter((event) => event.text && event.year === selectedYear)
          .map((event) => ({ ...event, kind: "event" as const }));
        const exactBirths = (data.births ?? [])
          .filter((event) => event.text && event.year === selectedYear)
          .map((event) => ({ ...event, kind: "birth" as const }));
        const rawEntries = [...exactEvents, ...exactBirths];
        let entries = rawEntries
          .map((event, index) => ({
            key: `${selectedCacheKey}-${index}`,
            dateKey: selectedCacheKey,
            year: event.year ?? selectedYear,
            text: formatHistoricalEntryText(
              event.kind === "birth" ? `nace ${event.text}` : event.text ?? "",
              categorizeHistoricalText(event.text ?? "")
            ),
            sourceName: "Wikimedia" as const,
            sourceUrl,
            fetchedAt: new Date().toISOString()
          }))
          .filter(isUsefulWorldHistoryEntry)
          .filter((entry) => entry.year === selectedYear);

        if (entries.length < 6 || !hasSpainWorldHistoryEntry(entries) || !hasGlobalWorldHistoryEntry(entries)) {
          const yearEntries = await fetchWikipediaYearHistoryEntries(
            selectedYear,
            selectedCacheKey,
            selectedEvent.date.getMonth() + 1
          );
          entries = mergeWorldHistoryEntries([...entries, ...yearEntries], selectedYear).slice(0, 8);
        }
        if (!cancelled) {
          onSaveWorldHistoryEvents(selectedCacheKey, entries);
          setWorldStatus(entries.length ? "" : t.noWorldHistory);
        }
      } catch {
        if (!cancelled) setWorldStatus(t.publicInfoSearchError);
      }
    }

    void loadWorldEvents();
    return () => {
      cancelled = true;
    };
  }, [onSaveWorldHistoryEvents, selectedCacheKey, selectedEvent, selectedWorldEvents.length, t, worldHistoryEvents]);

  if (!events.length) {
    return (
      <div className="empty-state">
        <h2>{t.history}</h2>
        <p>{t.noHistoryEvents}</p>
      </div>
    );
  }

  const spainHistoryEvents = selectedWorldEvents.filter(isSpainHistoryEntry);
  const globalHistoryEvents = selectedWorldEvents.filter((event) => !isSpainHistoryEntry(event));

  return (
    <div className="history-timeline-view">
      <div className="history-track" style={{ "--history-count": Math.max(1, events.length - 1) } as CSSProperties}>
        {events.map((event, index) => (
          <button
            className={index === selectedIndex ? "active" : ""}
            type="button"
            key={event.id}
            title={`${formatDateForDisplay(event.date)} · ${event.label}`}
            style={{ left: `${events.length === 1 ? 50 : (index / (events.length - 1)) * 100}%` }}
            onClick={() => setSelectedIndex(index)}
          >
            {index === selectedIndex ? <strong>{formatDateForDisplay(event.date)}</strong> : null}
            <span />
          </button>
        ))}
        <div className="history-year-markers" aria-hidden="true">
          {yearMarkers.map((marker) => (
            <small key={`${marker.year}-${marker.left}`} style={{ left: `${marker.left}%` }}>
              {marker.year}
            </small>
          ))}
        </div>
      </div>
      <div className="history-content-grid">
        <div className="history-text-column">
          <section>
            <strong>{t.familyHistory}</strong>
            <h2>{selectedEvent ? formatDateForDisplay(selectedEvent.date) : ""}</h2>
            <p>{selectedEvent?.detail}</p>
          </section>
          <section>
            <strong>{t.spainHistory}</strong>
            {spainHistoryEvents.length > 0 ? (
              <ul>
                {spainHistoryEvents.map((event) => (
                  <li key={event.key}>{capitalizeFirstLetter(stripHistoryEntryScope(event.text))}</li>
                ))}
              </ul>
            ) : (
              <p>{worldStatus || t.noWorldHistory}</p>
            )}
          </section>
          <section>
            <strong>{t.worldHistory}</strong>
            {globalHistoryEvents.length > 0 ? (
              <ul>
                {globalHistoryEvents.map((event) => (
                  <li key={event.key}>{capitalizeFirstLetter(stripHistoryEntryScope(event.text))}</li>
                ))}
              </ul>
            ) : (
              <p>{worldStatus || t.noWorldHistory}</p>
            )}
          </section>
        </div>
        <section className="history-photo-column">
          <strong>{t.gallery}</strong>
          {selectedPhotos.length > 0 ? (
            <div className="history-photo-grid">
              {selectedPhotos.map((photo) => (
                <figure key={photo.id}>
                  <img src={photo.dataUrl} alt={photo.title || photo.fileName || t.galleryPhoto} />
                  <figcaption>{photo.title || photo.fileName || t.galleryPhoto}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p>{t.noGalleryPhotos}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function LegacyFamilyHistoryTimelineUnused({
  people,
  relationships,
  t
}: {
  people: Person[];
  relationships: Relationship[];
  t: Record<string, string>;
}) {
  const events = useMemo(() => buildFamilyTimelineEvents(people, relationships, t), [people, relationships, t]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedEvent = events[Math.min(selectedIndex, Math.max(0, events.length - 1))];
  const [worldEvents, setWorldEvents] = useState<string[]>([]);
  const [worldStatus, setWorldStatus] = useState("");
  const yearMarkers = useMemo(() => buildHistoryYearMarkers(events), [events]);

  useEffect(() => {
    if (selectedIndex >= events.length) setSelectedIndex(Math.max(0, events.length - 1));
  }, [events.length, selectedIndex]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorldEvents() {
      if (!selectedEvent) return;
      setWorldStatus(t.publicInfoSearching);
      setWorldEvents([]);
      try {
        const month = String(selectedEvent.date.getMonth() + 1).padStart(2, "0");
        const day = String(selectedEvent.date.getDate()).padStart(2, "0");
        const response = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/es/onthisday/all/${month}/${day}`);
        if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`);
        const data = (await response.json()) as { events?: Array<{ year?: number; text?: string }> };
        const selectedYear = selectedEvent.date.getFullYear();
        const items = (data.events ?? [])
          .filter((event) => event.text && event.year === selectedYear)
          .slice(0, 4)
          .map((event) => (event.year ? `${event.year}: ${event.text}` : event.text ?? ""));
        if (!cancelled) {
          setWorldEvents(items);
          setWorldStatus(items.length ? "" : t.noWorldHistory);
        }
      } catch {
        if (!cancelled) setWorldStatus(t.publicInfoSearchError);
      }
    }

    void loadWorldEvents();
    return () => {
      cancelled = true;
    };
  }, [selectedEvent, t]);

  if (!events.length) {
    return (
      <div className="empty-state">
        <h2>{t.history}</h2>
        <p>{t.noHistoryEvents}</p>
      </div>
    );
  }

  return (
    <div className="history-timeline-view">
      <div className="history-track" style={{ "--history-count": Math.max(1, events.length - 1) } as CSSProperties}>
        {events.map((event, index) => (
          <button
            className={index === selectedIndex ? "active" : ""}
            type="button"
            key={event.id}
            title={`${formatDateForDisplay(event.date)} · ${event.label}`}
            style={{ left: `${events.length === 1 ? 50 : (index / (events.length - 1)) * 100}%` }}
            onClick={() => setSelectedIndex(index)}
          >
            {index === selectedIndex ? <strong>{formatDateForDisplay(event.date)}</strong> : null}
            <span />
          </button>
        ))}
        <div className="history-year-markers" aria-hidden="true">
          {yearMarkers.map((marker) => (
            <small key={`${marker.year}-${marker.left}`} style={{ left: `${marker.left}%` }}>
              {marker.year}
            </small>
          ))}
        </div>
      </div>
      <div className="history-panels">
        <section>
          <strong>{t.familyHistory}</strong>
          <h2>{selectedEvent ? formatDateForDisplay(selectedEvent.date) : ""}</h2>
          <p>{selectedEvent?.detail}</p>
        </section>
        <section>
          <strong>{t.worldHistory}</strong>
          {worldEvents.length > 0 ? (
            <ul>
              {worldEvents.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          ) : (
            <p>{worldStatus || t.noWorldHistory}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function buildHistoryYearMarkers(events: FamilyTimelineEvent[]) {
  if (!events.length) return [];
  const rawMarkers = events.map((event, index) => ({
    year: event.date.getFullYear(),
    left: events.length === 1 ? 50 : (index / (events.length - 1)) * 100
  }));
  const uniqueMarkers = rawMarkers.filter(
    (marker, index) => rawMarkers.findIndex((candidate) => candidate.year === marker.year) === index
  );
  if (uniqueMarkers.length <= 6) return uniqueMarkers;
  const lastIndex = uniqueMarkers.length - 1;
  return Array.from({ length: 6 }, (_, index) => uniqueMarkers[Math.round((index / 5) * lastIndex)]).filter(
    (marker, index, markers) => markers.findIndex((candidate) => candidate.year === marker.year) === index
  );
}

function compareWikimediaOnThisDayItems(
  first: { year?: number; pages?: unknown[] },
  second: { year?: number; pages?: unknown[] }
) {
  const firstScore = (first.pages?.length ?? 0) * 1000 + Math.max(0, first.year ?? 0);
  const secondScore = (second.pages?.length ?? 0) * 1000 + Math.max(0, second.year ?? 0);
  return secondScore - firstScore;
}

function isUsefulWorldHistoryEntry(entry: WorldHistoryEntry) {
  return isUsefulWorldHistoryText(entry.text, entry.year);
}

function normalizePlainText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulWorldHistoryText(text: string | undefined, year?: number) {
  const normalized = normalizePlainText(text ?? "");
  if (!normalized) return false;
  const yearPrefix = year ? `${year}: ` : "";
  const withoutYearPrefix = normalized.startsWith(yearPrefix) ? normalized.slice(yearPrefix.length) : normalized;
  const genericPatterns = [
    /\bfue un ano comun comenzado\b/,
    /\bfue un ano bisiesto comenzado\b/,
    /\bsegun el calendario gregoriano\b/,
    /\bano comun comenzado en\b/,
    /\bano bisiesto comenzado en\b/,
    /^\d{3,4} fue un ano\b/,
    /^ano \d{3,4}\b/
  ];
  return !genericPatterns.some((pattern) => pattern.test(withoutYearPrefix));
}

async function fetchWikipediaYearHistoryEntries(
  year: number,
  dateKey: string,
  preferredMonth?: number
): Promise<WorldHistoryEntry[]> {
  const sourceUrl = `https://es.wikipedia.org/wiki/${year}`;
  const apiUrl = `https://es.wikipedia.org/w/api.php?action=parse&format=json&origin=*&page=${year}&prop=text&disablelimitreport=1&disableeditsection=1`;
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`Wikipedia year HTTP ${response.status}`);
  const data = (await response.json()) as { parse?: { text?: Record<string, string> } };
  const html = data.parse?.text?.["*"] ?? "";
  if (!html) return [];

  const document = new DOMParser().parseFromString(html, "text/html");
  const items = collectWikipediaYearListItems(document);
  const monthItems = preferredMonth ? items.filter((item) => item.month === preferredMonth) : [];
  const primaryItems = monthItems.length ? monthItems : items;
  const selectedItems = selectHistoricalYearItems(primaryItems, items);

  return selectedItems
    .map((item, index) => {
      const category = item.kind === "birth" ? categorizeHistoricalText(item.text) : item.category;
      const text = item.kind === "birth" ? `nace ${item.text}` : item.text;
      return {
        key: `${dateKey}-year-${index}`,
        dateKey,
        year,
        text: formatHistoricalEntryText(text, category),
        sourceName: "Wikimedia" as const,
        sourceUrl,
        fetchedAt: new Date().toISOString()
      };
    })
    .filter(isUsefulWorldHistoryEntry);
}

function collectWikipediaYearListItems(document: Document) {
  const items: Array<{ text: string; kind: "event" | "birth"; category: "spain" | "world"; month?: number }> = [];
  let section: "events" | "births" | "" = "";
  let currentMonth: number | undefined;
  const nodes = Array.from(document.body.querySelectorAll("h2, h3, ul"));

  nodes.forEach((node) => {
    if (node.tagName === "H2") {
      const heading = normalizePlainText(node.textContent ?? "");
      if (heading.includes("acontecimientos")) section = "events";
      else if (heading.includes("nacimientos")) section = "births";
      else if (section) section = "";
      currentMonth = undefined;
      return;
    }

    if (node.tagName === "H3") {
      currentMonth = getSpanishMonthNumberFromText(node.textContent ?? "");
      return;
    }

    if (node.tagName !== "UL" || !section) return;
    Array.from(node.children)
      .filter((child) => child.tagName === "LI")
      .forEach((child) => {
        const rawText = child.textContent ?? "";
        const text = cleanHistoricalListText(rawText);
        if (!text || !isUsefulWorldHistoryText(text)) return;
        const category = categorizeHistoricalText(text);
        items.push({
          text,
          kind: section === "births" ? "birth" : "event",
          category,
          month: extractHistoricalItemMonth(rawText) ?? currentMonth
        });
      });
  });

  return items;
}

function selectHistoricalYearItems<
  T extends { text: string; kind: "event" | "birth"; category: "spain" | "world" }
>(primaryItems: T[], allItems: T[]) {
  const primarySpain = primaryItems.filter((item) => item.kind === "event" && item.category === "spain");
  const primaryWorld = primaryItems.filter((item) => item.kind === "event" && item.category === "world");
  const primaryBirths = primaryItems.filter((item) => item.kind === "birth");
  const fallbackSpain = allItems.filter((item) => item.kind === "event" && item.category === "spain");
  const fallbackWorld = allItems.filter((item) => item.kind === "event" && item.category === "world");
  const selected = [
    ...primarySpain.slice(0, 3),
    ...(primarySpain.length ? [] : fallbackSpain.slice(0, 1)),
    ...primaryWorld.slice(0, 3),
    ...(primaryWorld.length ? [] : fallbackWorld.slice(0, 1)),
    ...primaryBirths.slice(0, 2)
  ];
  return dedupeHistoricalItems(selected);
}

function dedupeHistoricalItems<T extends { text: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizePlainText(item.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanHistoricalListText(value: string) {
  return value
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\d{1,2}\s+de\s+[a-záéíóúñ]+\s*:?\s*/i, "")
    .replace(/^en\s+/i, "")
    .trim();
}

function extractHistoricalItemMonth(value: string) {
  const normalized = normalizePlainText(value);
  const match = normalized.match(/^\d{1,2}\s+de\s+([a-z]+)/);
  return match ? getSpanishMonthNumberFromText(match[1]) : undefined;
}

function getSpanishMonthNumberFromText(value: string) {
  const normalized = normalizePlainText(value);
  const months: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };
  return Object.entries(months).find(([monthName]) => normalized.includes(monthName))?.[1];
}

function categorizeHistoricalText(value: string): "spain" | "world" {
  const normalized = normalizePlainText(value);
  const spainPatterns = [
    "espana",
    "espanol",
    "espanola",
    "madrid",
    "barcelona",
    "valencia",
    "sevilla",
    "bilbao",
    "zaragoza",
    "malaga",
    "alfonso xiii",
    "primo de rivera",
    "dictadura de primo",
    "cortes espanolas",
    "guardia civil",
    "gobierno espanol"
  ];
  return spainPatterns.some((pattern) => normalized.includes(pattern)) ? "spain" : "world";
}

function formatHistoricalEntryText(text: string, category: "spain" | "world") {
  const cleaned = capitalizeFirstLetter(cleanHistoricalListText(text));
  const label = category === "spain" ? "España" : "Mundo";
  return `${label}: ${cleaned}`;
}

function hasSpainWorldHistoryEntry(entries: WorldHistoryEntry[]) {
  return entries.some((entry) => normalizePlainText(entry.text).startsWith("espana:"));
}

function hasGlobalWorldHistoryEntry(entries: WorldHistoryEntry[]) {
  return entries.some((entry) => normalizePlainText(entry.text).startsWith("mundo:"));
}

function isSpainHistoryEntry(entry: WorldHistoryEntry) {
  return normalizePlainText(entry.text).startsWith("espana:");
}

function stripHistoryEntryScope(text: string) {
  return text.replace(/^(España|Mundo):\s*/i, "");
}

function capitalizeFirstLetter(value: string) {
  const trimmed = value.trim();
  return trimmed.replace(
    /^(\P{L}*)(\p{L})/u,
    (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase("es")}`
  );
}

function mergeWorldHistoryEntries(entries: WorldHistoryEntry[], year: number) {
  const seen = new Set<string>();
  return entries
    .filter((entry) => entry.year === year && isUsefulWorldHistoryEntry(entry))
    .filter((entry) => {
      const key = normalizePlainText(entry.text).replace(/^(espana|mundo):\s*/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((first, second) => {
      const firstScore = (normalizePlainText(first.text).startsWith("espana:") ? 0 : 1) + first.text.length / 10000;
      const secondScore = (normalizePlainText(second.text).startsWith("espana:") ? 0 : 1) + second.text.length / 10000;
      return firstScore - secondScore;
    });
}

function buildWorldHistoryCacheKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isGalleryPhotoOnDate(photo: GalleryPhoto, date: Date) {
  const photoDate = parseFullDateParts(photo.takenAt);
  if (!photoDate) return false;
  return (
    photoDate.year === date.getFullYear() &&
    photoDate.month === date.getMonth() + 1 &&
    photoDate.day === date.getDate()
  );
}

function buildRegionalGenerations(people: Person[], relationships: Relationship[]): RegionalGeneration[] {
  if (people.length === 0) return [];

  const childrenByParent = new Map<string, string[]>();
  relationships
    .filter((relationship) => relationship.kind === "parent_child")
    .forEach((relationship) => {
      const childIds = childrenByParent.get(relationship.fromPersonId) ?? [];
      childIds.push(relationship.toPersonId);
      childrenByParent.set(relationship.fromPersonId, childIds);
    });

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  function getDepth(personId: string): number {
    if (depthById.has(personId)) return depthById.get(personId) ?? 0;
    if (visiting.has(personId)) return 0;

    visiting.add(personId);
    const childDepths = (childrenByParent.get(personId) ?? []).map((childId) => getDepth(childId));
    visiting.delete(personId);

    const depth = childDepths.length > 0 ? Math.max(...childDepths) + 1 : 0;
    depthById.set(personId, depth);
    return depth;
  }

  people.forEach((person) => getDepth(person.id));
  const maxDepth = Math.max(0, ...depthById.values());
  const groups = new Map<number, Person[]>();

  people.forEach((person) => {
    const generationIndex = maxDepth - (depthById.get(person.id) ?? 0);
    const generationPeople = groups.get(generationIndex) ?? [];
    generationPeople.push(person);
    groups.set(generationIndex, generationPeople);
  });

  return [...groups.entries()]
    .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)
    .map(([index, generationPeople]) => ({
      index,
      label: `${index + 1} GEN`,
      people: generationPeople
    }));
}

function buildPersonGenerationLabels(people: Person[], relationships: Relationship[]) {
  return buildRegionalGenerations(people, relationships).reduce<Record<string, string>>((labels, generation) => {
    generation.people.forEach((person) => {
      labels[person.id] = generation.label;
    });
    return labels;
  }, {});
}

function parseBirthday(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) return normalizeBirthday(Number(dayFirst[1]), Number(dayFirst[2]));

  const yearFirst = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (yearFirst) return normalizeBirthday(Number(yearFirst[3]), Number(yearFirst[2]));

  return null;
}

function normalizeBirthday(day: number, month: number) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = new Date(2024, month, 0).getDate();
  if (day < 1 || day > maxDay) return null;
  return { day, month };
}

function buildStarMap(person: Person) {
  const birthMoment = parseBirthMoment(person.birthDate, person.birthTime);
  const coords = getBirthCoordinates(person);
  if (!birthMoment || !coords) return null;

  const visibleStars = brightStars
    .map((star) => {
      const position = projectStarForMoment(star.ra, star.dec, coords.lat, coords.lng, birthMoment.date);
      if (!position) return null;
      const radius = Math.max(1.4, 5.8 - star.mag * 0.8);
      return {
        ...star,
        ...position,
        radius,
        opacity: Math.max(0.48, 1 - star.mag * 0.08),
        label: star.mag < 0.9 ? star.name : ""
      };
    })
    .filter((star): star is StarMapProjectedStar => Boolean(star));

  const starsById = new Map(visibleStars.map((star) => [star.id, star]));
  const lines = constellationLines
    .map(([fromId, toId]) => {
      const from = starsById.get(fromId);
      const to = starsById.get(toId);
      return from && to ? { id: `${fromId}-${toId}`, from, to } : null;
    })
    .filter((line): line is { id: string; from: StarMapProjectedStar; to: StarMapProjectedStar } => Boolean(line));

  return {
    stars: visibleStars,
    lines,
    label: `${person.birthDate} · ${person.birthTime} · ${formatCoordinates(coords.lat, coords.lng)}`
  };
}

function parseBirthMoment(dateValue?: string, timeValue?: string) {
  const dateParts = parseFullDateParts(dateValue);
  const timeParts = parseTimeParts(timeValue);
  if (!dateParts || !timeParts) return null;

  return {
    date: new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hour, timeParts.minute)),
    ...dateParts,
    ...timeParts
  };
}

function parseFullDateParts(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const yearFirst = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const day = dayFirst ? Number(dayFirst[1]) : yearFirst ? Number(yearFirst[3]) : NaN;
  const month = dayFirst ? Number(dayFirst[2]) : yearFirst ? Number(yearFirst[2]) : NaN;
  const year = dayFirst ? Number(dayFirst[3]) : yearFirst ? Number(yearFirst[1]) : NaN;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (!normalizeBirthday(day, month)) return null;
  return { day, month, year };
}

function getZodiacSignInfo(birthDate: string | undefined, t: Record<string, string>): ZodiacSignInfo | null {
  const date = parseFullDateParts(birthDate);
  if (!date) return null;
  const monthDay = date.month * 100 + date.day;
  if (monthDay >= 321 && monthDay <= 419) return buildZodiacSignInfo("aries", "♈", t.zodiacAries, "Aries_(astrología)");
  if (monthDay >= 420 && monthDay <= 520) return buildZodiacSignInfo("taurus", "♉", t.zodiacTaurus, "Tauro_(astrología)");
  if (monthDay >= 521 && monthDay <= 620) return buildZodiacSignInfo("gemini", "♊", t.zodiacGemini, "Géminis_(astrología)");
  if (monthDay >= 621 && monthDay <= 722) return buildZodiacSignInfo("cancer", "♋", t.zodiacCancer, "Cáncer_(astrología)");
  if (monthDay >= 723 && monthDay <= 822) return buildZodiacSignInfo("leo", "♌", t.zodiacLeo, "Leo_(astrología)");
  if (monthDay >= 823 && monthDay <= 922) return buildZodiacSignInfo("virgo", "♍", t.zodiacVirgo, "Virgo_(astrología)");
  if (monthDay >= 923 && monthDay <= 1022) return buildZodiacSignInfo("libra", "♎", t.zodiacLibra, "Libra_(astrología)");
  if (monthDay >= 1023 && monthDay <= 1121) return buildZodiacSignInfo("scorpio", "♏", t.zodiacScorpio, "Escorpio_(astrología)");
  if (monthDay >= 1122 && monthDay <= 1221) return buildZodiacSignInfo("sagittarius", "♐", t.zodiacSagittarius, "Sagitario_(astrología)");
  if (monthDay >= 1222 || monthDay <= 119) return buildZodiacSignInfo("capricorn", "♑", t.zodiacCapricorn, "Capricornio_(astrología)");
  if (monthDay >= 120 && monthDay <= 218) return buildZodiacSignInfo("aquarius", "♒", t.zodiacAquarius, "Acuario_(astrología)");
  return buildZodiacSignInfo("pisces", "♓", t.zodiacPisces, "Piscis_(astrología)");
}

function buildZodiacSignInfo(key: string, symbol: string, label: string, pageTitle: string): ZodiacSignInfo {
  const canonical = getCanonicalZodiacInfoClean(key);
  return {
    key,
    symbol: canonical.symbol || symbol,
    label,
    pageTitle: canonical.pageTitle || pageTitle,
    sourceUrl: `https://es.wikipedia.org/wiki/${encodeURIComponent(canonical.pageTitle || pageTitle)}`
  };
}

function formatZodiacSign(sign: ZodiacSignInfo | null) {
  return sign ? `${sign.symbol} ${sign.label}` : "";
}

function formatBirthSummary(person: Person, birthPlace: { city: string; country: string }, fallback: string) {
  const date = formatShortDateForDisplay(person.birthDate);
  const time = person.birthTime?.trim();
  const city = birthPlace.city || person.birthCity || "";
  const country = birthPlace.country || person.birthCountry || "";
  const location = city || country ? `${city || fallback}${country ? ` (${country})` : ""}` : fallback;

  if (!date && !time && !city && !country) return fallback;

  const datePart = date ? `Nació el ${date}` : "Nacimiento sin fecha registrada";
  const timePart = time ? ` · ${time}` : "";
  const placePart = city || country ? ` en ${location}` : "";
  return `${datePart}${timePart}${placePart}`;
}

function formatShortDateForDisplay(value?: string) {
  const parts = parseFullDateParts(value);
  if (!parts) return "";
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${String(parts.year).slice(-2)}`;
}

function birthDateCacheValue(value: string | undefined, famousBirths: Record<string, FamousBirthMatch | null>) {
  const parts = parseFullDateParts(value);
  if (!parts) return undefined;
  const cacheKey = getFamousBirthCacheKey(parts.year, parts.month, parts.day);
  return Object.prototype.hasOwnProperty.call(famousBirths, cacheKey) ? famousBirths[cacheKey] : undefined;
}

function getFamousBirthCacheKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function fetchFamousBirthForDate(
  year: number,
  month: number,
  day: number,
  currentPersonName: string
): Promise<FamousBirthMatch | null> {
  const path = `/cumpleanos/${buildMediamassBirthdaySlug(year, month, day)}`;
  const sourceUrl = `https://es.mediamass.net${path}`;
  const html = await fetchMediamassBirthdayHtml(path, sourceUrl);
  const match = parseMediamassFamousBirth(html, sourceUrl, currentPersonName);
  if (!match) return null;

  return {
    ...match,
    wikipediaUrl: await resolveSpanishWikipediaUrl(match.name)
  };
}

async function fetchMediamassBirthdayHtml(path: string, sourceUrl: string) {
  try {
    const response = await fetch(`/mediamass-api${path}`);
    if (response.ok) return response.text();
  } catch {
    // Fall back to a reader proxy when the local proxy is not available.
  }

  try {
    const directResponse = await fetch(sourceUrl);
    if (directResponse.ok) return directResponse.text();
  } catch {
    // Some browser contexts block direct cross-origin reads.
  }

  const readerResponse = await fetch(`https://r.jina.ai/http://${sourceUrl.replace(/^https?:\/\//, "")}`);
  if (!readerResponse.ok) throw new Error(`Mediamass HTTP ${readerResponse.status}`);
  return readerResponse.text();
}

function parseMediamassFamousBirth(html: string, sourceUrl: string, currentPersonName: string): FamousBirthMatch | null {
  const document = new DOMParser().parseFromString(html, "text/html");
  const normalizedCurrentPersonName = normalizePlainText(currentPersonName);
  const candidates = Array.from(document.querySelectorAll(".celebrityList .name a, .celebrityList .celebrity .name a"))
    .map((element) => cleanFamousBirthName(element.textContent ?? ""))
    .filter((candidate) => candidate && normalizePlainText(candidate) !== normalizedCurrentPersonName)
    .sort((first, second) => first.localeCompare(second, "es"));

  if (candidates[0]) return { name: candidates[0], sourceUrl };

  const description =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ??
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ??
    "";
  const descriptionMatch = description.match(/\(([^)]+)\)/);
  const fallbackName = cleanFamousBirthName(descriptionMatch?.[1] ?? "");
  if (fallbackName && normalizePlainText(fallbackName) !== normalizedCurrentPersonName) {
    return { name: fallbackName, sourceUrl };
  }

  return null;
}

async function resolveSpanishWikipediaUrl(name: string) {
  const fallbackUrl = buildSpanishWikipediaArticleUrl(name);

  try {
    const apiUrl = `https://es.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srsearch=${encodeURIComponent(
      `"${name}"`
    )}&srlimit=1`;
    const response = await fetch(apiUrl);
    if (!response.ok) return fallbackUrl;
    const data = (await response.json()) as { query?: { search?: Array<{ title?: string }> } };
    const title = data.query?.search?.[0]?.title;
    return title ? `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}` : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

function getFamousBirthWikipediaUrl(match: FamousBirthMatch) {
  return match.wikipediaUrl || buildSpanishWikipediaArticleUrl(match.name);
}

function buildSpanishWikipediaArticleUrl(name: string) {
  return `https://es.wikipedia.org/wiki/${encodeURIComponent(name.trim().replace(/\s+/g, "_"))}`;
}

function buildMediamassBirthdaySlug(year: number, month: number, day: number) {
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre"
  ];
  return `${day}-de-${months[month - 1]}-de-${year}`;
}

function cleanFamousBirthName(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCanonicalZodiacInfo(key: string) {
  const values: Record<string, { symbol: string; pageTitle: string }> = {
    aries: { symbol: "♈", pageTitle: "Aries_(astrología)" },
    taurus: { symbol: "♉", pageTitle: "Tauro_(astrología)" },
    gemini: { symbol: "♊", pageTitle: "Géminis_(astrología)" },
    cancer: { symbol: "♋", pageTitle: "Cáncer_(astrología)" },
    leo: { symbol: "♌", pageTitle: "Leo_(astrología)" },
    virgo: { symbol: "♍", pageTitle: "Virgo_(astrología)" },
    libra: { symbol: "♎", pageTitle: "Libra_(astrología)" },
    scorpio: { symbol: "♏", pageTitle: "Escorpio_(astrología)" },
    sagittarius: { symbol: "♐", pageTitle: "Sagitario_(astrología)" },
    capricorn: { symbol: "♑", pageTitle: "Capricornio_(astrología)" },
    aquarius: { symbol: "♒", pageTitle: "Acuario_(astrología)" },
    pisces: { symbol: "♓", pageTitle: "Piscis_(astrología)" }
  };
  return values[key] ?? { symbol: "", pageTitle: "" };
}

function getZodiacPersonalityText(key: string) {
  const values: Record<string, string> = {
    aries:
      "En la tradición astrológica, Aries se asocia con iniciativa, energía directa y tendencia a actuar con rapidez. Suele describirse como un signo decidido, competitivo y espontáneo.",
    taurus:
      "En la tradición astrológica, Tauro se asocia con constancia, paciencia y búsqueda de estabilidad. Suele describirse como un signo práctico, sensorial y perseverante.",
    gemini:
      "En la tradición astrológica, Géminis se asocia con curiosidad, comunicación y adaptación. Suele describirse como un signo inquieto, versátil y mentalmente ágil.",
    cancer:
      "En la tradición astrológica, Cáncer se asocia con sensibilidad, memoria emocional y protección. Suele describirse como un signo familiar, intuitivo y cuidadoso.",
    leo:
      "En la tradición astrológica, Leo se asocia con expresividad, creatividad y orgullo personal. Suele describirse como un signo generoso, visible y con deseo de reconocimiento.",
    virgo:
      "En la tradición astrológica, Virgo se asocia con análisis, orden y atención al detalle. Suele describirse como un signo práctico, observador y orientado a mejorar lo que le rodea.",
    libra:
      "En la tradición astrológica, Libra se asocia con equilibrio, sociabilidad y sentido de la armonía. Suele describirse como un signo diplomático, estético y atento a las relaciones.",
    scorpio:
      "En la tradición astrológica, Escorpio se asocia con intensidad, reserva y transformación. Suele describirse como un signo profundo, intuitivo y emocionalmente resistente.",
    sagittarius:
      "En la tradición astrológica, Sagitario se asocia con optimismo, independencia y búsqueda de sentido. Suele describirse como un signo aventurero, franco y abierto al aprendizaje.",
    capricorn:
      "En la tradición astrológica, Capricornio se asocia con ambición, disciplina y sentido de la responsabilidad. Suele describirse como un signo constante, prudente y orientado a objetivos.",
    aquarius:
      "En la tradición astrológica, Acuario se asocia con independencia, originalidad y visión colectiva. Suele describirse como un signo innovador, idealista y poco convencional.",
    pisces:
      "En la tradición astrológica, Piscis se asocia con empatía, imaginación e intuición. Suele describirse como un signo sensible, receptivo y vinculado al mundo emocional."
  };
  return values[key] ?? "La tradición astrológica asocia cada signo con ciertos rasgos simbólicos de carácter, siempre como interpretación cultural y no como dato verificable.";
}

const ZODIAC_TRAITS_SOURCE_URL =
  "https://www.abc.es/recreo/abci-caracteristicas-signos-zodiacos-rasgos-importantes-de-cada-signo-horoscopo-nsv-202107201036_noticia.html";

function getCanonicalZodiacInfoClean(key: string) {
  const values: Record<string, { symbol: string; pageTitle: string }> = {
    aries: { symbol: "♈", pageTitle: "Aries_(astrología)" },
    taurus: { symbol: "♉", pageTitle: "Tauro_(astrología)" },
    gemini: { symbol: "♊", pageTitle: "Géminis_(astrología)" },
    cancer: { symbol: "♋", pageTitle: "Cáncer_(astrología)" },
    leo: { symbol: "♌", pageTitle: "Leo_(astrología)" },
    virgo: { symbol: "♍", pageTitle: "Virgo_(astrología)" },
    libra: { symbol: "♎", pageTitle: "Libra_(astrología)" },
    scorpio: { symbol: "♏", pageTitle: "Escorpio_(astrología)" },
    sagittarius: { symbol: "♐", pageTitle: "Sagitario_(astrología)" },
    capricorn: { symbol: "♑", pageTitle: "Capricornio_(astrología)" },
    aquarius: { symbol: "♒", pageTitle: "Acuario_(astrología)" },
    pisces: { symbol: "♓", pageTitle: "Piscis_(astrología)" }
  };
  return values[key] ?? { symbol: "", pageTitle: "" };
}

function getZodiacPersonalityTextClean(key: string) {
  const values: Record<string, string> = {
    aries:
      "Aries se presenta como un signo impulsivo, competitivo y lleno de energía. Tiende a actuar rápido, defender sus ideas con fuerza y buscar nuevos retos con entusiasmo.",
    taurus:
      "Tauro se describe como constante, paciente y muy vinculado a la seguridad. Suele valorar la calma, la estabilidad y la perseverancia, aunque puede mostrarse terco cuando algo le importa.",
    gemini:
      "Géminis destaca por la curiosidad, la comunicación y la capacidad de adaptarse. Se asocia con una mente rápida, gusto por conversar y facilidad para moverse entre ideas distintas.",
    cancer:
      "Cáncer se relaciona con sensibilidad, intuición y protección. Suele conceder mucha importancia a los vínculos afectivos, a la familia y a la memoria emocional.",
    leo:
      "Leo se asocia con seguridad, creatividad y deseo de brillar. Suele mostrarse generoso, orgulloso y expresivo, con tendencia a liderar y a buscar reconocimiento.",
    virgo:
      "Virgo se caracteriza por el análisis, la observación y la atención al detalle. Tiende a buscar orden, utilidad y mejora constante, con una mirada práctica sobre lo cotidiano.",
    libra:
      "Libra se vincula con equilibrio, diplomacia y sentido estético. Suele buscar armonía en las relaciones, cuidar las formas y mediar cuando surgen tensiones.",
    scorpio:
      "Escorpio se describe como intenso, reservado y profundamente emocional. Se asocia con intuición, magnetismo y una fuerte capacidad para afrontar cambios o transformaciones.",
    sagittarius:
      "Sagitario se relaciona con optimismo, sinceridad y espíritu aventurero. Suele buscar libertad, aprendizaje y experiencias que amplíen su forma de ver el mundo.",
    capricorn:
      "Capricornio se asocia con responsabilidad, disciplina y ambición serena. Tiende a avanzar con paciencia, planificar a largo plazo y sostener sus metas con constancia.",
    aquarius:
      "Acuario se presenta como independiente, original y mentalmente abierto. Se asocia con ideas innovadoras, visión colectiva y una forma poco convencional de entender la vida.",
    pisces:
      "Piscis se relaciona con empatía, imaginación e intuición. Suele describirse como sensible, receptivo y muy conectado con el mundo emocional y creativo."
  };
  return (
    values[key] ??
    "La astrología asocia cada signo con ciertos rasgos simbólicos de carácter, siempre como interpretación cultural y no como dato verificable."
  );
}

function parseTimeParts(value?: string) {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function hasExactBirthCoordinates(person: Person) {
  return Number.isFinite(person.birthLatitude) && Number.isFinite(person.birthLongitude);
}

function getBirthCoordinates(person: Person) {
  if (hasExactBirthCoordinates(person)) {
    return { lat: Number(person.birthLatitude), lng: Number(person.birthLongitude) };
  }

  const location = resolveBirthLocation(person);
  return location ? { lat: location.lat, lng: location.lon } : null;
}

function projectStarForMoment(raHours: number, decDegrees: number, latDegrees: number, lngDegrees: number, date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = jd - 2451545.0;
  const gmstHours = normalizeHours(18.697374558 + 24.06570982441908 * daysSinceJ2000);
  const localSiderealDegrees = normalizeDegrees((gmstHours + lngDegrees / 15) * 15);
  const hourAngle = degreesToRadians(normalizeDegrees(localSiderealDegrees - raHours * 15));
  const dec = degreesToRadians(decDegrees);
  const lat = degreesToRadians(latDegrees);
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(hourAngle);
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  if (altitude <= 0) return null;

  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle)
  );
  const altitudeDegrees = radiansToDegrees(altitude);
  const radius = ((90 - altitudeDegrees) / 90) * 238;
  return {
    x: 250 + radius * Math.sin(azimuth),
    y: 250 - radius * Math.cos(azimuth)
  };
}

function normalizeHours(value: number) {
  return ((value % 24) + 24) % 24;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function formatCoordinates(lat: number, lng: number) {
  return `${formatDecimalNumber(lat, 3)}, ${formatDecimalNumber(lng, 3)}`;
}

function buildCalendarDays(year: number, monthIndex: number) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  return [
    ...Array.from({ length: mondayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1)
  ];
}

function buildFamilyTimelineEvents(people: Person[], relationships: Relationship[], t: Record<string, string>) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const events: FamilyTimelineEvent[] = [];

  people.forEach((person) => {
    const name = fullName(person) || t.person;
    const birthDate = parseFullDateParts(person.birthDate);
    if (birthDate) {
      const date = createValidDate(birthDate.year, birthDate.month, birthDate.day) ?? new Date(birthDate.year, birthDate.month - 1, birthDate.day);
      events.push({
        id: `birth-${person.id}`,
        date,
        label: `${t.birth}: ${name}`,
        detail: `Nace ${name}.`,
        type: "birth"
      });
    }

    const deathDate = parseFullDateParts(person.deathDate);
    if (deathDate) {
      const date = createValidDate(deathDate.year, deathDate.month, deathDate.day) ?? new Date(deathDate.year, deathDate.month - 1, deathDate.day);
      events.push({
        id: `death-${person.id}`,
        date,
        label: `${t.death}: ${name}`,
        detail: `Fallece ${name}.`,
        type: "death"
      });
    }
  });

  relationships
    .filter((relationship) => relationship.kind === "partner" || relationship.kind === "spouse")
    .forEach((relationship) => {
      const startDate = parseFullDateParts(relationship.startDate);
      if (!startDate) return;
      const first = peopleById.get(relationship.fromPersonId);
      const second = peopleById.get(relationship.toPersonId);
      if (!first || !second) return;
      const date = createValidDate(startDate.year, startDate.month, startDate.day) ?? new Date(startDate.year, startDate.month - 1, startDate.day);
      const firstName = fullName(first) || t.person;
      const secondName = fullName(second) || t.person;
      events.push({
        id: `relationship-${relationship.id}`,
        date,
        label: `${t.relationships}: ${firstName} · ${secondName}`,
        detail: `${firstName} y ${secondName} comienzan su vida juntos.`,
        type: "relationship"
      });
    });

  return events.sort((first, second) => first.date.getTime() - second.date.getTime());
}

function formatDateForDisplay(date: Date) {
  return new Intl.DateTimeFormat("es", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function createValidDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function getMonthName(monthIndex: number, t: Record<string, string>) {
  return t[`month_${monthIndex + 1}`];
}

function getWeekdayLabels(t: Record<string, string>) {
  return [t.weekdayMon, t.weekdayTue, t.weekdayWed, t.weekdayThu, t.weekdayFri, t.weekdaySat, t.weekdaySun];
}

function getSaintDateForPerson(person: Person) {
  const firstName = person.givenName.trim().split(/\s+/)[0];
  if (!firstName) return null;

  return saintDaysByName[normalizePlaceName(firstName)] ?? null;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function getAutonomousCommunity(person: Person) {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const haystack = normalizePlaceName(
    [place.city, place.country, person.birthPlace, person.birthCity, person.birthCountry].filter(Boolean).join(" ")
  );

  return findAutonomousCommunityInText(haystack);
}

function getKnownAutonomousCommunityForPerson(person: Person) {
  const directCommunity = getAutonomousCommunity(person);
  if (directCommunity) return directCommunity;

  for (const key of getBirthPlaceRegionKeys(person)) {
    const cachedCommunity = getCommunityByCode(localStorage.getItem(`opentree.region.osm.${key}`) ?? undefined);
    if (cachedCommunity) return cachedCommunity;
  }

  return null;
}

function shouldCheckAutonomousCommunity(person: Person) {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const city = normalizePlaceName(place.city || person.birthCity || person.birthPlace);
  const country = normalizePlaceName(place.country || person.birthCountry);

  if (!city) return false;
  if (!country) return true;

  return isSpainCountryName(country);
}

function isSpainCountryName(country: string) {
  const normalized = normalizePlaceName(country);
  return normalized === "es" || normalized === "espana" || normalized === "spain" || /\b(espana|spain)\b/.test(normalized);
}

function getCommunityByCode(code?: string) {
  return autonomousCommunities.find((community) => community.code === code) ?? null;
}

function findAutonomousCommunityInText(value = "") {
  const normalized = normalizePlaceName(value);
  return (
    autonomousCommunities.find((community) =>
      community.keywords.some((keyword) => normalized.includes(normalizePlaceName(keyword)))
    ) ?? null
  );
}

async function resolveAutonomousCommunityFromAddress(address: string): Promise<AutonomousCommunity | null> {
  const normalizedAddress = normalizePlaceName(address);
  if (!normalizedAddress) return null;

  const cacheKey = `opentree.region.osm.${normalizedAddress}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return getCommunityByCode(cached);

  try {
    const location: GeocodeResult | null = await geocodeAddress(address);
    const community = getCommunityByCode(location?.communityCode) ?? findAutonomousCommunityInText(location?.label ?? address);

    if (community) {
      localStorage.setItem(cacheKey, community.code);
      normalizedAddress
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((key) => localStorage.setItem(`opentree.region.osm.${key}`, community.code));
    }

    return community;
  } catch {
    return null;
  }
}

function draftToPerson(
  id: string,
  draft: PersonDraft,
  gender: Person["gender"],
  fallbackGivenName: string,
  notes = ""
): Person {
  return {
    id,
    givenName: draft.givenName.trim() || fallbackGivenName,
    familyName: draft.familyName.trim(),
    gender,
    birthDate: draft.birthDate.trim(),
    birthCity: draft.birthCity.trim(),
    birthCountry: draft.birthCountry.trim(),
    birthPlace: joinPlace(draft.birthCity, draft.birthCountry),
    notes,
    events: []
  };
}

function hasDraftData(draft: PersonDraft) {
  return Boolean(
    draft.givenName.trim() ||
      draft.familyName.trim() ||
      draft.birthDate.trim() ||
      draft.birthCity.trim() ||
      draft.birthCountry.trim()
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTreeStyle(value: unknown): NonNullable<TreeProject["displaySettings"]>["treeStyle"] {
  return value === "medieval" || value === "epic" || value === "japanese" ? value : "neutral";
}

function normalizeClinicalConditionName(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim();
}

function compareClinicalConditions(first: ClinicalCondition, second: ClinicalCondition) {
  return first.name.localeCompare(second.name, "es", { sensitivity: "base" });
}

function getAffectedPeople(people: Person[], conditionId: string) {
  return people.filter((person) => (person.clinicalConditionIds ?? []).includes(conditionId));
}

const CLINICAL_CATEGORY_COLORS = ["#d97706", "#0891b2", "#7c3aed", "#dc2626", "#16a34a", "#db2777", "#4f46e5"];

function getNextClinicalCategoryColor(categories: ClinicalConditionCategory[]) {
  return CLINICAL_CATEGORY_COLORS[categories.length % CLINICAL_CATEGORY_COLORS.length];
}

function buildGoogleExactSearchUrl(name: string) {
  const query = `"${name.trim()}"`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

async function fetchPublicSearchHtml(query: string) {
  try {
    return await invoke<string>("fetch_public_search_html", { query });
  } catch (error) {
    console.warn("Tauri public search failed, trying web fallback.", error);
    const response = await fetch(`https://r.jina.ai/http://duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error(`Public search fallback failed: ${response.status}`);
    return response.text();
  }
}

async function fetchPublicPageHtml(url: string) {
  try {
    return await invoke<string>("fetch_public_page_html", { url });
  } catch (error) {
    console.warn("Tauri public page fetch failed, trying web fallback.", error);
    const response = await fetch(`https://r.jina.ai/http://${url}`);
    if (!response.ok) throw new Error(`Public page fallback failed: ${response.status}`);
    return response.text();
  }
}

async function enrichPublicInfoPreview(preview: PublicInfoPreview): Promise<PublicInfoPreview> {
  const url = normalizeInputUrl(preview.url);
  if (!url) return preview;

  try {
    const html = await fetchPublicPageHtml(url);
    const metadata = parsePublicPageMetadata(html, url);
    return {
      title: metadata.title || preview.title || url,
      url,
      snippet: metadata.snippet || preview.snippet,
      imageUrl: metadata.imageUrl || preview.imageUrl || ""
    };
  } catch (error) {
    console.warn("Public metadata enrichment failed.", error);
    return {
      ...preview,
      title: preview.title || url,
      url,
      imageUrl: preview.imageUrl || ""
    };
  }
}

function parsePublicPageMetadata(html: string, sourceUrl: string): PublicInfoPreview {
  const document = new DOMParser().parseFromString(html, "text/html");
  const readMeta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? "";
  const title =
    readMeta('meta[property="og:title"]') ||
    readMeta('meta[name="twitter:title"]') ||
    document.querySelector("title")?.textContent?.trim() ||
    document.querySelector("h1")?.textContent?.trim() ||
    parseMarkdownTitle(html);
  const snippet =
    readMeta('meta[property="og:description"]') ||
    readMeta('meta[name="twitter:description"]') ||
    readMeta('meta[name="description"]') ||
    parseMarkdownDescription(html);
  const imageUrl =
    readMeta('meta[property="og:image"]') ||
    readMeta('meta[name="twitter:image"]') ||
    document.querySelector<HTMLImageElement>("img")?.src?.trim() ||
    "";

  return {
    title: cleanSearchText(title),
    url: sourceUrl,
    snippet: cleanSearchText(snippet),
    imageUrl: resolvePublicAssetUrl(imageUrl, sourceUrl)
  };
}

function parseMarkdownTitle(value: string) {
  return value.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ?? value.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function parseMarkdownDescription(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => cleanSearchText(stripMarkdown(line)))
    .filter((line) => line && !line.startsWith("Title:") && !line.startsWith("URL Source:") && !line.startsWith("Markdown Content:"));
  return lines.find((line) => line.length > 80) ?? lines[0] ?? "";
}

function resolvePublicAssetUrl(assetUrl: string, sourceUrl: string) {
  if (!assetUrl.trim()) return "";
  try {
    return new URL(assetUrl, sourceUrl).href;
  } catch {
    return assetUrl.trim();
  }
}

function getPublicPreviewFallbackLabel(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "").slice(0, 2).toUpperCase();
  } catch {
    return "↗";
  }
}

function normalizeInputUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function parsePublicSearchResults(html: string): PublicInfoPreview[] {
  if (html.includes("Markdown Content:") || /^## \[.+?\]\(/m.test(html)) {
    return parsePublicSearchMarkdownResults(html);
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const results = Array.from(document.querySelectorAll(".result")).slice(0, 8);

  return results.reduce<PublicInfoPreview[]>((items, result) => {
    const link = result.querySelector<HTMLAnchorElement>(".result__a");
    const snippet = result.querySelector<HTMLElement>(".result__snippet")?.textContent?.trim() ?? "";
    if (!link?.href) return items;

    items.push({
      title: cleanSearchText(link.textContent ?? ""),
      url: normalizeDuckDuckGoResultUrl(link.href),
      snippet: cleanSearchText(snippet)
    });

    return items;
  }, []);
}

function parsePublicSearchMarkdownResults(markdown: string): PublicInfoPreview[] {
  const lines = markdown.split(/\r?\n/);
  const results: PublicInfoPreview[] = [];

  for (let index = 0; index < lines.length && results.length < 8; index += 1) {
    const titleMatch = lines[index].match(/^## \[(.+?)\]\((.+?)\)/);
    if (!titleMatch) continue;

    const title = cleanSearchText(stripMarkdown(titleMatch[1]));
    const url = normalizeDuckDuckGoResultUrl(titleMatch[2]);
    let snippet = "";

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex].trim();
      if (line.startsWith("## [")) break;
      if (!line || line.startsWith("[![") || /^\[.+?\]\(.+?\)$/.test(line)) continue;
      snippet = cleanSearchText(stripMarkdown(line));
      if (snippet) break;
    }

    if (url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function stripMarkdown(value: string) {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/!\[(.*?)\]\((.*?)\)/g, "")
    .trim();
}

function normalizeDuckDuckGoResultUrl(url: string) {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return url;
  }
}

function cleanSearchText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

async function fetchMayoClinicConditionProfile(conditionName: string) {
  const query = conditionName.trim();
  if (!query) return null;

  const sourceUrl = await findMayoClinicConditionUrl(query);
  if (!sourceUrl) return null;

  let profile: { title: string; summary: string; symptoms: string } | null = null;
  try {
    const html = await fetchMayoClinicHtml(new URL(sourceUrl).pathname);
    profile = parseMayoClinicConditionProfileClean(html, query);
  } catch {
    profile = null;
  }

  if (!profile?.summary && !profile?.symptoms) {
    profile = getMayoClinicKnownConditionProfile(query);
  }

  if (!profile?.summary && !profile?.symptoms) return null;

  return {
    ...profile,
    sourceName: "Mayo Clinic",
    sourceUrl
  };
}

const mayoClinicKnownConditionUrls: Record<string, string> = {
  "cancer de mama": "https://www.mayoclinic.org/es/diseases-conditions/breast-cancer/symptoms-causes/syc-20352470",
  "cáncer de mama": "https://www.mayoclinic.org/es/diseases-conditions/breast-cancer/symptoms-causes/syc-20352470",
  "intolerancia a la lactosa": "https://www.mayoclinic.org/es/diseases-conditions/lactose-intolerance/symptoms-causes/syc-20374232"
};

function getMayoClinicKnownConditionUrl(conditionName: string) {
  const normalized = normalizePlaceName(conditionName);
  const directUrl = mayoClinicKnownConditionUrls[normalized];
  if (directUrl) return directUrl;
  if (normalized.includes("intoler") && normalized.includes("lactosa")) {
    return mayoClinicKnownConditionUrls["intolerancia a la lactosa"];
  }
  if (normalized.includes("cancer") && normalized.includes("mama")) {
    return mayoClinicKnownConditionUrls["cancer de mama"];
  }
  return null;
}

function getMayoClinicKnownConditionProfile(conditionName: string) {
  const normalized = normalizePlaceName(conditionName);
  if (normalized.includes("intoler") && normalized.includes("lactosa")) {
    return {
      title: "Intolerancia a la lactosa",
      summary:
        "Las personas con intolerancia a la lactosa no pueden digerir correctamente la lactosa de la leche. Esto puede provocar diarrea, gases e hinchazon despues de tomar productos lacteos. La afeccion suele relacionarse con niveles bajos de lactasa en el intestino delgado.",
      symptoms: ["Diarrea", "Nauseas y, a veces, vomitos", "Colicos estomacales", "Hinchazon", "Gases"].join("\n\n")
    };
  }
  return null;
}

async function findMayoClinicConditionUrl(conditionName: string) {
  const knownUrl = getMayoClinicKnownConditionUrl(conditionName);
  if (knownUrl) return knownUrl;

  const html = await fetchPublicSearchHtml(`site:mayoclinic.org/es/diseases-conditions ${conditionName} síntomas causas Mayo Clinic`);
  const results = parsePublicSearchResults(html);
  const mayoResult = results.find((result) => {
    try {
      const url = new URL(result.url);
      return (
        url.hostname.endsWith("mayoclinic.org") &&
        url.pathname.startsWith("/es/diseases-conditions/") &&
        url.pathname.includes("/symptoms-causes/")
      );
    } catch {
      return false;
    }
  });

  return mayoResult?.url ?? null;
}

async function fetchMayoClinicHtml(path: string) {
  const sourceUrl = `https://www.mayoclinic.org${path}`;
  const attempts: Array<() => Promise<string>> = [];

  if ("__TAURI_INTERNALS__" in window) {
    attempts.push(() => invoke<string>("fetch_mayo_clinic_html", { path }));
  } else {
    attempts.push(async () => {
      const response = await fetch(`/mayo-clinic-api${path}`);
      if (!response.ok) throw new Error(`Mayo Clinic request failed: ${response.status}`);
      return response.text();
    });
  }

  attempts.push(async () => {
    const response = await fetch(`https://r.jina.ai/http://${sourceUrl}`);
    if (!response.ok) throw new Error(`Mayo Clinic reader request failed: ${response.status}`);
    return response.text();
  });

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const html = await attempt();
      if (html) return html;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No se ha podido consultar Mayo Clinic.");
}

function parseMayoClinicConditionProfileClean(html: string, fallbackTitle: string) {
  if (html.includes("Markdown Content:") || /^##\s+/m.test(html)) {
    return parseMayoClinicMarkdownProfileClean(html, fallbackTitle);
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const title = cleanSearchText(document.querySelector("h1")?.textContent ?? fallbackTitle);

  return {
    title,
    summary: collectMayoClinicHtmlSectionClean(
      document,
      ["descripcion general", "descripción general"],
      ["tipos", "sintomas", "síntomas"],
      "paragraphs"
    ),
    symptoms: collectMayoClinicHtmlSectionClean(
      document,
      ["sintomas", "síntomas"],
      ["causas", "factores de riesgo", "prevencion", "prevención"],
      "bullets"
    )
  };
}

function collectMayoClinicHtmlSectionClean(
  document: Document,
  startHeadings: string[],
  stopHeadings: string[],
  mode: "paragraphs" | "bullets"
) {
  const headings = Array.from(document.querySelectorAll("h2, h3"));
  const start = headings.find((heading) => startHeadings.includes(normalizePlaceName(heading.textContent ?? "")));
  if (!start) return "";

  const lines: string[] = [];
  let current = start.nextElementSibling;
  while (current) {
    const tagName = current.tagName.toLowerCase();
    const normalizedHeading = normalizePlaceName(current.textContent ?? "");
    if ((tagName === "h2" || tagName === "h3") && stopHeadings.includes(normalizedHeading)) break;
    if (tagName === "h3" && /cuando consultar|mas informacion|más informacion|productos y servicios/.test(normalizedHeading)) break;

    if (mode === "bullets") {
      current.querySelectorAll("li").forEach((element) => {
        const text = cleanMayoClinicLine(element.textContent ?? "");
        if (text) lines.push(text);
      });
      if (tagName === "li") {
        const text = cleanMayoClinicLine(current.textContent ?? "");
        if (text) lines.push(text);
      }
    } else {
      const paragraphElements = tagName === "p" ? [current] : Array.from(current.querySelectorAll("p"));
      paragraphElements.forEach((element) => {
        const text = cleanMayoClinicLine(element.textContent ?? "");
        if (text) lines.push(text);
      });
    }

    current = current.nextElementSibling;
  }

  return limitMayoClinicText(lines);
}

function parseMayoClinicMarkdownProfileClean(markdown: string, fallbackTitle: string) {
  const lines = markdown.split(/\r?\n/);
  const title =
    cleanSearchText(stripMarkdown(lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "") ?? "")) ||
    fallbackTitle;

  return {
    title,
    summary: collectMayoClinicMarkdownSectionClean(
      lines,
      ["descripcion general", "descripción general"],
      ["tipos", "sintomas", "síntomas"],
      "paragraphs"
    ),
    symptoms: collectMayoClinicMarkdownSectionClean(
      lines,
      ["sintomas", "síntomas"],
      ["causas", "factores de riesgo", "prevencion", "prevención"],
      "bullets"
    )
  };
}

function collectMayoClinicMarkdownSectionClean(
  lines: string[],
  startHeadings: string[],
  stopHeadings: string[],
  mode: "paragraphs" | "bullets"
) {
  const collected: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      const headingLevel = headingMatch[1].length;
      const heading = normalizePlaceName(stripMarkdown(headingMatch[2]));
      if (!collecting && startHeadings.includes(heading)) {
        collecting = true;
        continue;
      }
      if (collecting && (stopHeadings.includes(heading) || headingLevel === 2 || /cuando consultar|mas informacion|más informacion/.test(heading))) {
        break;
      }
    }

    if (!collecting || !trimmed) continue;
    const isBullet = /^[-*]\s+/.test(trimmed);
    if (mode === "bullets" && !isBullet) continue;
    if (mode === "paragraphs" && isBullet) continue;
    const text = cleanMayoClinicLine(stripMarkdown(trimmed.replace(/^[-*]\s+/, "")));
    if (text) collected.push(text);
  }

  return limitMayoClinicText(collected);
}

function parseMayoClinicConditionProfile(html: string, sourceUrl: string, fallbackTitle: string) {
  if (html.includes("Markdown Content:") || /^##\s+/m.test(html)) {
    return parseMayoClinicMarkdownProfile(html, fallbackTitle);
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const title = cleanSearchText(document.querySelector("h1")?.textContent ?? fallbackTitle);
  const summary = collectMayoClinicHtmlSection(document, ["descripcion general", "descripción general"], ["tipos", "sintomas", "síntomas"]);
  const symptoms = collectMayoClinicHtmlSection(document, ["sintomas", "síntomas"], ["causas", "factores de riesgo", "prevencion", "prevención"]);

  return {
    title,
    summary,
    symptoms
  };
}

function collectMayoClinicHtmlSection(document: Document, startHeadings: string[], stopHeadings: string[]) {
  const headings = Array.from(document.querySelectorAll("h2, h3"));
  const start = headings.find((heading) => startHeadings.includes(normalizePlaceName(heading.textContent ?? "")));
  if (!start) return "";

  const lines: string[] = [];
  let current = start.nextElementSibling;
  while (current) {
    const tagName = current.tagName.toLowerCase();
    const normalizedHeading = normalizePlaceName(current.textContent ?? "");
    if (tagName === "h2" && stopHeadings.includes(normalizedHeading)) break;
    if (tagName === "h3" && /cuando consultar|mas informacion|más informacion|productos y servicios/.test(normalizedHeading)) break;

    if (tagName === "p" || tagName === "li") {
      const text = cleanMayoClinicLine(current.textContent ?? "");
      if (text) lines.push(text);
    } else {
      current.querySelectorAll("p, li").forEach((element) => {
        const text = cleanMayoClinicLine(element.textContent ?? "");
        if (text) lines.push(text);
      });
    }

    current = current.nextElementSibling;
  }

  return limitMayoClinicText(lines);
}

function parseMayoClinicMarkdownProfile(markdown: string, fallbackTitle: string) {
  const lines = markdown.split(/\r?\n/);
  const title =
    cleanSearchText(stripMarkdown(lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "") ?? "")) ||
    fallbackTitle;

  return {
    title,
    summary: collectMayoClinicMarkdownSection(lines, ["descripcion general", "descripción general"], ["tipos", "sintomas", "síntomas"]),
    symptoms: collectMayoClinicMarkdownSection(lines, ["sintomas", "síntomas"], ["causas", "factores de riesgo", "prevencion", "prevención"])
  };
}

function collectMayoClinicMarkdownSection(lines: string[], startHeadings: string[], stopHeadings: string[]) {
  const collected: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{2,3})\s+(.+)$/);
    if (headingMatch) {
      const headingLevel = headingMatch[1].length;
      const heading = normalizePlaceName(stripMarkdown(headingMatch[2]));
      if (!collecting && startHeadings.includes(heading)) {
        collecting = true;
        continue;
      }
      if (collecting && (stopHeadings.includes(heading) || headingLevel === 2 || /cuando consultar|mas informacion|más informacion/.test(heading))) {
        break;
      }
    }

    if (!collecting || !trimmed) continue;
    const text = cleanMayoClinicLine(stripMarkdown(trimmed.replace(/^[-*]\s+/, "")));
    if (text) collected.push(text);
  }

  return limitMayoClinicText(collected);
}

function cleanMayoClinicLine(value: string) {
  const cleaned = cleanSearchText(value)
    .replace(/^Cerrar$/i, "")
    .replace(/Agrandar la imagen/gi, "")
    .trim();

  if (!cleaned) return "";
  if (/^(productos y servicios|mostrar mas|mostrar más|solicite una consulta|imprimir)$/i.test(cleaned)) return "";
  if (/^image:/i.test(cleaned)) return "";
  return cleaned;
}

function limitMayoClinicText(lines: string[]) {
  const uniqueLines = lines.filter((line, index, all) => all.indexOf(line) === index);
  return truncateAtWord(uniqueLines.slice(0, 10).join("\n\n"), 1600);
}

async function fetchMedlinePlusConditionProfile(conditionName: string) {
  const query = conditionName.trim();
  if (!query) return null;

  const path = `/ws/query?db=healthTopicsSpanish&term=${encodeURIComponent(query)}&retmax=1&rettype=brief&tool=OpenTree`;
  const xml = await fetchMedlinePlusXml(path);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error("MedlinePlus ha devuelto XML no válido.");

  const result = document.querySelector("document[url]");
  if (!result) return null;

  const title = getMedlineContent(result, "title") || query;
  const summary = buildMedlineBriefDescription(
    cleanHtmlText(getMedlineContent(result, "FullSummary") || getMedlineContent(result, "snippet"))
  );
  if (!summary) return null;

  return {
    title,
    summary,
    sourceName: "MedlinePlus",
    sourceUrl: result.getAttribute("url") ?? "https://medlineplus.gov/spanish/"
  };
}

async function fetchMedlinePlusXml(path: string) {
  try {
    return await invoke<string>("fetch_medlineplus_xml", { path });
  } catch (tauriError) {
    const attempts = [`/medlineplus-api${path}`, `https://wsearch.nlm.nih.gov${path}`];
    let lastError = tauriError;

    for (const url of attempts) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/xml,text/xml" }
        });
        if (!response.ok) {
          throw new Error(`MedlinePlus ha devuelto HTTP ${response.status}`);
        }

        return await response.text();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("No se ha podido consultar MedlinePlus.");
  }
}

function getMedlineContent(documentNode: Element, name: string) {
  return Array.from(documentNode.querySelectorAll("content"))
    .find((content) => content.getAttribute("name")?.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"))
    ?.textContent?.trim();
}

function cleanHtmlText(value = "") {
  const withoutTags = value.replace(/<[^>]+>/g, " ");
  const textArea = document.createElement("textarea");
  textArea.innerHTML = withoutTags;
  return textArea.value.replace(/\s+/g, " ").trim();
}

function buildMedlineBriefDescription(summary: string) {
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const briefText = sentences.slice(0, 4).join(" ") || summary;

  return truncateAtWord(briefText, 620);
}

function truncateAtWord(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const trimmed = value.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return `${trimmed}...`;
}

async function cropGalleryPhotoRegion(dataUrl: string, region: GalleryFaceRegion) {
  const image = await loadImageElement(dataUrl);
  const canvas = document.createElement("canvas");
  const sourceX = Math.max(0, (region.x / 100) * image.naturalWidth);
  const sourceY = Math.max(0, (region.y / 100) * image.naturalHeight);
  const sourceWidth = Math.min(image.naturalWidth - sourceX, (region.width / 100) * image.naturalWidth);
  const sourceHeight = Math.min(image.naturalHeight - sourceY, (region.height / 100) * image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context || sourceWidth <= 0 || sourceHeight <= 0) return dataUrl;

  const maxOutputSide = 520;
  const scale = Math.min(1, maxOutputSide / Math.max(sourceWidth, sourceHeight));
  const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
  const outputHeight = Math.max(1, Math.round(sourceHeight * scale));

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load gallery image"));
    image.src = dataUrl;
  });
}

async function buildGalleryPhotoFromFile(file: File, now: string): Promise<GalleryPhoto> {
  const [dataUrl, metadata] = await Promise.all([
    normalizeGalleryImage(file),
    parseGalleryExif(file)
  ]);

  return {
    id: createId("photo"),
    title: file.name.replace(/\.[^.]+$/, ""),
    dataUrl,
    fileName: file.name,
    takenAt: metadata.takenAt,
    location: metadata.location,
    latitude: metadata.latitude,
    longitude: metadata.longitude,
    personIds: [],
    createdAt: now,
    updatedAt: now
  };
}

async function normalizeGalleryImage(file: File) {
  const dataUrl = await readFileAsDataUrl(file);

  try {
    const image = await loadImageElement(dataUrl);
    const maxSize = 1600;
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return dataUrl;
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read image"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read image")));
    reader.readAsDataURL(file);
  });
}

async function parseGalleryExif(file: File) {
  try {
    const metadata = await parseExif(file, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "latitude", "longitude", "GPSLatitude", "GPSLongitude"]
    });
    const takenAt = formatExifDate(metadata?.DateTimeOriginal ?? metadata?.CreateDate ?? metadata?.ModifyDate);
    const latitude = numberOrUndefined(metadata?.latitude ?? metadata?.GPSLatitude);
    const longitude = numberOrUndefined(metadata?.longitude ?? metadata?.GPSLongitude);
    const location =
      latitude !== undefined && longitude !== undefined
        ? await reverseGeocodeOpenStreetMap(latitude, longitude)
        : "";

    return { takenAt, latitude, longitude, location };
  } catch {
    return { takenAt: "", latitude: undefined, longitude: undefined, location: "" };
  }
}

function formatExifDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (typeof value !== "string") return "";
  const match = value.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function numberOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function reverseGeocodeOpenStreetMap(latitude: number, longitude: number) {
  const fallback = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const cacheKey = `opentree.reverse.osm.${fallback}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&addressdetails=1&lat=${latitude}&lon=${longitude}`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) return fallback;

    const result = (await response.json()) as { display_name?: string; address?: Record<string, string> };
    const address = result.address ?? {};
    const city = address.city || address.town || address.village || address.municipality || address.county || "";
    const region = address.state || address.province || address.region || "";
    const country = address.country || "";
    const label = [city, region, country].map((part) => part.trim()).filter(Boolean).join(", ") || result.display_name || fallback;

    localStorage.setItem(cacheKey, label);
    return label;
  } catch {
    return fallback;
  }
}

function compareGalleryPhotos(first: GalleryPhoto, second: GalleryPhoto) {
  return galleryDateTime(second) - galleryDateTime(first);
}

function galleryDateTime(photo: GalleryPhoto) {
  const year = extractYear(photo.takenAt);
  if (year) return year;
  return new Date(photo.createdAt).getTime() || 0;
}

function getGalleryYearBounds(photos: GalleryPhoto[]) {
  const years = photos
    .map((photo) => extractYear(photo.takenAt))
    .filter((year): year is number => year !== null)
    .sort((first, second) => first - second);

  if (years.length === 0) return null;
  return { min: years[0], max: years[years.length - 1] };
}

function formatGalleryMeta(photo: GalleryPhoto, t: Record<string, string>) {
  return [photo.takenAt, photo.location].filter(Boolean).join(" · ") || t.galleryNoMetadata;
}

function hasGalleryPhotoCoordinates(photo: GalleryPhoto): photo is GalleryPhoto & { latitude: number; longitude: number } {
  return Number.isFinite(photo.latitude) && Number.isFinite(photo.longitude);
}

function isGalleryPhotoInsideBounds(photo: GalleryPhoto, bounds: GalleryMapBounds) {
  if (!hasGalleryPhotoCoordinates(photo)) return false;
  return (
    photo.latitude <= bounds.north &&
    photo.latitude >= bounds.south &&
    photo.longitude <= bounds.east &&
    photo.longitude >= bounds.west
  );
}

function getGalleryThumbnailFocus(photo: GalleryPhoto) {
  const regions = photo.faceRegions ?? [];
  if (regions.length === 0) return "50% 50%";

  const center = regions.reduce(
    (acc, region) => ({
      x: acc.x + region.x + region.width / 2,
      y: acc.y + region.y + region.height / 2
    }),
    { x: 0, y: 0 }
  );

  return `${clampPercent(center.x / regions.length)}% ${clampPercent(center.y / regions.length)}%`;
}

function getGalleryPointerPoint(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clampPercent(((event.clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((event.clientY - rect.top) / rect.height) * 100)
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number(value.toFixed(2))));
}

function clampZoom(value: number) {
  return Math.min(1.8, Math.max(0.25, Number(value.toFixed(2))));
}

function splitPlace(place = "", storedCity = "", storedCountry = "") {
  if (storedCity || storedCountry) {
    return {
      city: storedCity,
      country: storedCountry
    };
  }

  if (place && !place.includes(",")) {
    return {
      city: "",
      country: place.trim()
    };
  }

  const [city = "", ...rest] = place.split(",");
  return {
    city: city.trim(),
    country: rest.join(",").trim()
  };
}

function joinPlace(city: string, country: string) {
  return [city, country].map((part) => part.trim()).filter(Boolean).join(", ");
}

function formatPlaceDate(date?: string, place?: string) {
  return [date, place].map((part) => part?.trim()).filter(Boolean).join(", ");
}

function getBirthAddress(person: Person) {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  return joinPlace(place.city, place.country);
}

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const osmLocation = await geocodeOpenStreetMap(address);
  return enrichGeocodeCommunity(osmLocation, address);
}

function enrichGeocodeCommunity(location: GeocodeResult | null, address: string): GeocodeResult | null {
  if (!location) return null;
  if (location.communityCode) return location;

  const community = findAutonomousCommunityInText([location.label, address].filter(Boolean).join(" "));
  if (!community) return location;

  return {
    ...location,
    communityCode: community.code
  };
}

async function geocodeOpenStreetMap(address: string): Promise<GeocodeResult | null> {
  const normalizedAddress = normalizePlaceName(address);
  const cacheKey = `opentree.geocode.osm.${normalizedAddress}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    const parsed = JSON.parse(cached) as { lat: number; lng: number; communityCode?: string; coords?: { lat: number; lng: number } };
    const coords = parsed.coords ?? { lat: parsed.lat, lng: parsed.lng };
    const cachedCommunityCode = parsed.communityCode ?? localStorage.getItem(`opentree.region.osm.${normalizedAddress}`) ?? undefined;
    if (cachedCommunityCode) {
      return {
        coords,
        communityCode: cachedCommunityCode,
        fromCache: true
      };
    }
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(address)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!response.ok) throw new Error("OpenStreetMap geocoding failed");

  const results = (await response.json()) as Array<{ lat: string; lon: string; address?: Record<string, string>; display_name?: string }>;
  const location = results[0];
  if (!location) return null;

  const coords = {
    lat: Number(location.lat),
    lng: Number(location.lon)
  };

  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;

  const addressValues = location.address ? Object.values(location.address) : [];
  const community: AutonomousCommunity | null = findAutonomousCommunityInText(
    [...addressValues, location.display_name, address].filter(Boolean).join(" ")
  );
  const cacheValue = { ...coords, communityCode: community?.code };
  localStorage.setItem(cacheKey, JSON.stringify(cacheValue));

  if (community) {
    localStorage.setItem(`opentree.region.osm.${normalizedAddress}`, community.code);
    normalizedAddress
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((key) => localStorage.setItem(`opentree.region.osm.${key}`, community.code));
  }

  return { coords, communityCode: community?.code, fromCache: false };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function drawLeafletBirthMap(
  mapElement: HTMLDivElement,
  locatedGroups: MapLocatedGroup[],
  showPhotos: boolean,
  onSelect: (person: Person) => void
) {
  const map = L.map(mapElement, {
    zoomControl: true,
    attributionControl: true
  }).setView([40.42, -3.7], 5);

  addSoftBaseMapLayer(map);

  const bounds = L.latLngBounds([]);
  locatedGroups.forEach((group) => bounds.extend([group.coords.lat, group.coords.lng]));

  const markerLayer = L.layerGroup().addTo(map);
  const renderClusteredMarkers = () => {
    markerLayer.clearLayers();
    buildMapClusters(map, locatedGroups).forEach((cluster) => {
      const singleGroup = cluster.groups.length === 1 ? cluster.groups[0] : null;
      if (singleGroup && singleGroup.people.length > 1 && map.getZoom() >= 12) {
        renderMapPersonMarkers(L, map, markerLayer, singleGroup, showPhotos, onSelect);
        return;
      }

      const markerSize = getMapMarkerSize(cluster.count);
      const marker = L.marker([cluster.center.lat, cluster.center.lng], {
        icon: L.divIcon({
          className: "map-count-marker-wrapper",
          html: buildMapMarkerHtml(cluster, markerSize, showPhotos),
          iconSize: [markerSize, markerSize],
          iconAnchor: [markerSize / 2, markerSize / 2]
        })
      }).addTo(markerLayer);

      marker.on("click", () => {
        if (cluster.groups.length > 1) {
          map.fitBounds(
            L.latLngBounds(cluster.groups.map((group) => [group.coords.lat, group.coords.lng])),
            { padding: [44, 44], maxZoom: Math.min(map.getZoom() + 3, 14) }
          );
          return;
        }

        if (singleGroup?.people.length === 1) {
          onSelect(singleGroup.people[0]);
          return;
        }

        map.setView(
          [cluster.groups[0].coords.lat, cluster.groups[0].coords.lng],
          Math.max(map.getZoom() + 2, 11)
        );
      });
    });
  };

  renderClusteredMarkers();
  map.on("zoomend moveend", renderClusteredMarkers);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });

  return map;
}

async function drawLeafletPhotoMap(
  mapElement: HTMLDivElement,
  photos: Array<GalleryPhoto & { latitude: number; longitude: number }>,
  t: Record<string, string>
) {
  const map = L.map(mapElement, {
    zoomControl: true,
    attributionControl: true
  }).setView([40.42, -3.7], 5);

  addSoftBaseMapLayer(map);

  const bounds = L.latLngBounds([]);
  photos.forEach((photo) => bounds.extend([photo.latitude, photo.longitude]));

  const markerLayer = L.layerGroup().addTo(map);
  const renderClusteredMarkers = () => {
    markerLayer.clearLayers();
    buildPhotoMapClusters(map, photos).forEach((cluster) => {
      const markerSize = getMapMarkerSize(cluster.photos.length);
      const singlePhoto = cluster.photos.length === 1 ? cluster.photos[0] : null;
      const marker = L.marker([cluster.center.lat, cluster.center.lng], {
        icon: L.divIcon({
          className: "map-count-marker-wrapper",
          html: buildPhotoMapMarkerHtml(cluster.photos, markerSize, t),
          iconSize: [markerSize, markerSize],
          iconAnchor: [markerSize / 2, markerSize / 2]
        })
      }).addTo(markerLayer);

      marker.on("click", () => {
        if (cluster.photos.length > 1) {
          map.fitBounds(
            L.latLngBounds(cluster.photos.map((photo) => [photo.latitude, photo.longitude])),
            { padding: [44, 44], maxZoom: Math.min(map.getZoom() + 3, 15) }
          );
          return;
        }

        if (singlePhoto) {
          marker
            .bindPopup(buildPhotoMapPopupHtml(singlePhoto, t), {
              className: "map-photo-popup",
              maxWidth: 240
            })
            .openPopup();
        }
      });
    });
  };

  renderClusteredMarkers();
  map.on("zoomend moveend", renderClusteredMarkers);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });

  return map;
}

async function drawLeafletMigrationMap(
  mapElement: HTMLDivElement,
  migrationMapData: MigrationMapData
) {
  const { groups, links } = migrationMapData;
  const map = L.map(mapElement, {
    zoomControl: true,
    attributionControl: true
  }).setView([40.42, -3.7], 5);

  addSoftBaseMapLayer(map);

  const bounds = L.latLngBounds([]);
  groups.forEach((group) => bounds.extend([group.coords.lat, group.coords.lng]));

  const markerLayer = L.layerGroup().addTo(map);
  const lineLayer = L.layerGroup().addTo(map);

  const renderMigration = () => {
    markerLayer.clearLayers();
    lineLayer.clearLayers();

    links.forEach((link) => {
      const linePoints: L.LatLngExpression[] = [
        [link.from.coords.lat, link.from.coords.lng],
        [link.to.coords.lat, link.to.coords.lng]
      ];
      L.polyline(linePoints, {
        color: "#101917",
        weight: link.type === "external_partner" ? 2 : 2.2,
        opacity: link.type === "external_partner" ? 0.74 : 0.86
      }).addTo(lineLayer);

      const midpoint: L.LatLngExpression = [
        (link.from.coords.lat + link.to.coords.lat) / 2,
        (link.from.coords.lng + link.to.coords.lng) / 2
      ];
      const fromPoint = map.latLngToLayerPoint([link.from.coords.lat, link.from.coords.lng]);
      const toPoint = map.latLngToLayerPoint([link.to.coords.lat, link.to.coords.lng]);
      const angle = (Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x) * 180) / Math.PI;
      L.marker(midpoint, {
        icon: L.divIcon({
          className: "map-migration-arrow-wrapper",
          html: `<span class="map-migration-arrow ${link.type}" style="transform:rotate(${angle}deg)"></span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        }),
        interactive: false
      }).addTo(lineLayer);
    });

    groups.forEach((group) => {
      const markerSize = getMapMarkerSize(group.people.length);
      const flagStyle = group.flagUrl ? `background-image:url('${escapeCssUrl(group.flagUrl)}')` : "";
      L.marker([group.coords.lat, group.coords.lng], {
        icon: L.divIcon({
          className: "map-count-marker-wrapper",
          html: `<span class="map-count-marker map-migration-marker" style="width:${markerSize}px;height:${markerSize}px;${flagStyle}"></span>`,
          iconSize: [markerSize, markerSize],
          iconAnchor: [markerSize / 2, markerSize / 2]
        })
      })
        .bindTooltip(`${escapeHtml(group.generationLabel)} · ${escapeHtml(group.label)} · ${group.people.length}`)
        .addTo(markerLayer);
    });
  };

  renderMigration();
  map.on("zoomend moveend", renderMigration);
  map.fitBounds(bounds, { padding: [74, 74], maxZoom: 9 });

  return map;
}

function getMigrationGenerationColor(index: number) {
  const colors = ["#087d72", "#d97a26", "#2865a8", "#a83f75", "#5b7c2d", "#7b5ab7", "#b34b35"];
  return colors[(Math.max(1, index) - 1) % colors.length];
}

function getMapMarkerSize(count: number) {
  return Math.min(76, Math.max(36, 32 + Math.sqrt(count) * 10));
}

function addSoftBaseMapLayer(map: L.Map) {
  return L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    className: "soft-map-tiles"
  }).addTo(map);
}

function buildMapMarkerHtml(
  cluster: {
    groups: MapLocatedGroup[];
    count: number;
  },
  size: number,
  showPhotos: boolean
) {
  const singlePerson = cluster.count === 1 ? cluster.groups[0]?.people[0] : null;

  if (!singlePerson) {
    return `<span class="map-count-marker" style="width:${size}px;height:${size}px">${cluster.count}</span>`;
  }

  const photoStyle =
    showPhotos && singlePerson.photoUrl
      ? `background-image:url('${escapeCssUrl(singlePerson.photoUrl)}')`
      : "";
  const content = photoStyle ? "" : getPersonInitials(singlePerson);

  return `<span class="map-count-marker map-person-marker" style="width:${size}px;height:${size}px;${photoStyle}">${content}</span>`;
}

function buildPhotoMapMarkerHtml(
  photos: Array<GalleryPhoto & { latitude: number; longitude: number }>,
  size: number,
  t: Record<string, string>
) {
  if (photos.length !== 1) {
    return `<span class="map-count-marker map-photo-cluster-marker" style="width:${size}px;height:${size}px">${photos.length}</span>`;
  }

  const photo = photos[0];
  return `<span class="map-count-marker map-photo-marker" title="${escapeHtml(photo.title || photo.fileName || t.galleryPhoto)}" style="width:${size}px;height:${size}px;background-image:url('${escapeCssUrl(photo.dataUrl)}')"></span>`;
}

function buildPhotoMapPopupHtml(photo: GalleryPhoto, t: Record<string, string>) {
  const title = escapeHtml(photo.title || photo.fileName || t.galleryPhoto);
  const meta = escapeHtml(formatGalleryMeta(photo, t));
  return `<article class="map-photo-popup-card"><img src="${escapeCssUrl(photo.dataUrl)}" alt=""><strong>${title}</strong><span>${meta}</span></article>`;
}

function renderMapPersonMarkers(
  L: any,
  map: any,
  markerLayer: any,
  group: MapLocatedGroup,
  showPhotos: boolean,
  onSelect: (person: Person) => void
) {
  const markerSize = getMapMarkerSize(1);
  const centerPoint = map.latLngToLayerPoint([group.coords.lat, group.coords.lng]);
  const radius = Math.min(120, Math.max(44, group.people.length * 8));

  group.people.forEach((person, index) => {
    const angle = (Math.PI * 2 * index) / group.people.length - Math.PI / 2;
    const point =
      group.people.length === 1
        ? centerPoint
        : {
            x: centerPoint.x + Math.cos(angle) * radius,
            y: centerPoint.y + Math.sin(angle) * radius
          };
    const latLng = map.layerPointToLatLng(point);
    const marker = L.marker(latLng, {
      icon: L.divIcon({
        className: "map-count-marker-wrapper",
        html: buildMapMarkerHtml({ groups: [{ ...group, people: [person] }], count: 1 }, markerSize, showPhotos),
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2]
      })
    }).addTo(markerLayer);

    marker.on("click", () => {
      onSelect(person);
    });
  });
}

function getPersonInitials(person: Person) {
  const parts = [person.givenName, person.familyName]
    .map((part) => part.trim().slice(0, 1))
    .filter(Boolean);
  return escapeHtml(parts.join("") || "?");
}

function escapeCssUrl(value: string) {
  return value.replace(/['"\\\n\r]/g, "");
}

function buildMapClusters(map: any, groups: MapLocatedGroup[]) {
  return buildMapClustersFromPoints(groups, (coords) => {
    const point = map.latLngToLayerPoint([coords.lat, coords.lng]);
    return { x: point.x, y: point.y };
  });
}

function buildPhotoMapClusters(
  map: any,
  photos: Array<GalleryPhoto & { latitude: number; longitude: number }>
) {
  const clusters: Array<{
    photos: Array<GalleryPhoto & { latitude: number; longitude: number }>;
    center: { lat: number; lng: number };
    point: { x: number; y: number };
  }> = [];

  photos.forEach((photo) => {
    const point = map.latLngToLayerPoint([photo.latitude, photo.longitude]);
    const nearbyCluster = clusters.find((cluster) => {
      const minDistance = (getMapMarkerSize(cluster.photos.length) + getMapMarkerSize(1)) / 2 + 10;
      return Math.hypot(cluster.point.x - point.x, cluster.point.y - point.y) < minDistance;
    });

    if (!nearbyCluster) {
      clusters.push({
        photos: [photo],
        center: { lat: photo.latitude, lng: photo.longitude },
        point
      });
      return;
    }

    const nextCount = nearbyCluster.photos.length + 1;
    nearbyCluster.center = {
      lat: (nearbyCluster.center.lat * nearbyCluster.photos.length + photo.latitude) / nextCount,
      lng: (nearbyCluster.center.lng * nearbyCluster.photos.length + photo.longitude) / nextCount
    };
    nearbyCluster.point = {
      x: (nearbyCluster.point.x * nearbyCluster.photos.length + point.x) / nextCount,
      y: (nearbyCluster.point.y * nearbyCluster.photos.length + point.y) / nextCount
    };
    nearbyCluster.photos.push(photo);
  });

  return clusters;
}

function buildMapClustersFromPoints(
  groups: MapLocatedGroup[],
  project: (coords: { lat: number; lng: number }) => { x: number; y: number }
) {
  const clusters: Array<{
    groups: MapLocatedGroup[];
    count: number;
    center: { lat: number; lng: number };
    point: { x: number; y: number };
  }> = [];

  groups.forEach((group) => {
    const groupCount = group.people.length;
    const point = project(group.coords);
    const nearbyCluster = clusters.find((cluster) => {
      const minDistance = (getMapMarkerSize(cluster.count) + getMapMarkerSize(groupCount)) / 2 + 10;
      return Math.hypot(cluster.point.x - point.x, cluster.point.y - point.y) < minDistance;
    });

    if (!nearbyCluster) {
      clusters.push({
        groups: [group],
        count: groupCount,
        center: group.coords,
        point
      });
      return;
    }

    const nextCount = nearbyCluster.count + groupCount;
    nearbyCluster.groups.push(group);
    nearbyCluster.center = {
      lat: (nearbyCluster.center.lat * nearbyCluster.count + group.coords.lat * groupCount) / nextCount,
      lng: (nearbyCluster.center.lng * nearbyCluster.count + group.coords.lng * groupCount) / nextCount
    };
    nearbyCluster.point = {
      x: (nearbyCluster.point.x * nearbyCluster.count + point.x * groupCount) / nextCount,
      y: (nearbyCluster.point.y * nearbyCluster.count + point.y * groupCount) / nextCount
    };
    nearbyCluster.count = nextCount;
  });

  return clusters;
}

function formatContributionValue(value: unknown) {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return String(value ?? "");
}

function isPendingContribution(contribution: ContributionRecord) {
  if (contribution.status !== "pending") return false;
  return (
    hasContributionPatchValues(contribution.personPatch) ||
    Boolean(contribution.relatedPatches?.some((patch) => hasContributionPatchValues(patch.personPatch)))
  );
}

function hasContributionPatchValues(patch: ContributionRecord["personPatch"] = {}) {
  return Object.values(patch).some((value) => value !== undefined);
}

function resolveBirthLocation(person: Person) {
  const place = splitPlace(person.birthPlace, person.birthCity, person.birthCountry);
  const city = normalizePlaceName(place.city);
  const country = normalizePlaceName(place.country);
  const cityCountryKey = [city, country].filter(Boolean).join(",");
  const cityKey = city;
  const countryKey = country;
  const coords = cityCountryCoordinates[cityCountryKey] ?? cityCoordinates[cityKey] ?? countryCoordinates[countryKey];

  if (!coords) return null;

  return {
    ...coords,
    label: joinPlace(place.city, place.country) || person.birthPlace || coords.label
  };
}

function projectMapPoint(lat: number, lon: number) {
  return {
    x: ((lon + 180) / 360) * 100,
    y: ((90 - lat) / 180) * 100
  };
}

function normalizePlaceName(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._;:()]/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function wikimediaFlagUrl(fileName: string) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=128`;
}

function buildSurnameSummaries(people: Person[]): SurnameSummary[] {
  const groups = new Map<string, SurnameSummary>();

  people.forEach((person) => {
    extractSurnames(person.familyName).forEach((surname) => {
      const group = groups.get(surname) ?? { surname, count: 0, people: [], places: [] };
      group.count += 1;
      group.people.push(person);
      const place = getBirthAddress(person);
      if (place && !group.places.includes(place)) {
        group.places.push(place);
      }
      groups.set(surname, group);
    });
  });

  return [...groups.values()].sort((first, second) => second.count - first.count || first.surname.localeCompare(second.surname));
}

function buildPendingSurnameEnrichmentSignature(
  summaries: SurnameSummary[],
  profiles: Record<string, SurnameProfile>
) {
  return summaries
    .map((summary) => {
      const profile = profiles[normalizeSurnameKey(summary.surname)];
      const missingFields = [
        profile?.ine ? "" : "ine",
        profile?.forebears ? "" : "forebears",
        profile?.coatOfArmsUrl ? "" : "coat",
        needsSurnameMeaningRefresh(profile?.meaning, summary.surname) ? "meaning" : ""
      ].filter(Boolean);

      return missingFields.length > 0 ? `${normalizeSurnameKey(summary.surname)}:${missingFields.join("+")}` : "";
    })
    .filter(Boolean)
    .join("|");
}

function buildPendingGivenNameEnrichmentSignature(people: Person[], profiles: Record<string, GivenNameProfile>) {
  return buildPendingGivenNameList(people, profiles)
    .map((name) => normalizeNameKey(name))
    .join("|");
}

function buildPendingGivenNameList(people: Person[], profiles: Record<string, GivenNameProfile>) {
  const names = new Map<string, string>();

  people.forEach((person) => {
    const name = extractFirstGivenName(person.givenName);
    if (!name) return;

    const key = normalizeNameKey(name);
    if (!profiles[key]?.meaning?.trim()) {
      names.set(key, toTitleCase(name));
    }
  });

  return [...names.values()].sort((first, second) => first.localeCompare(second, "es", { sensitivity: "base" }));
}

function extractSurnames(familyName = "") {
  const particles = new Set(["de", "del", "la", "las", "los", "y", "e"]);
  return familyName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !particles.has(normalizePlaceName(part)))
    .map(toTitleCase)
    .filter((part, index, parts) => parts.indexOf(part) === index);
}

function normalizeSurnameKey(surname: string) {
  return normalizePlaceName(surname);
}

function normalizeNameKey(name: string) {
  return normalizePlaceName(extractFirstGivenName(name));
}

function extractFirstGivenName(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

function toTitleCase(value: string) {
  return value
    .toLocaleLowerCase("es")
    .replace(/(^|[-\s])\p{L}/gu, (letter) => letter.toLocaleUpperCase("es"));
}

async function fetchIneSurnameStats(surname: string): Promise<NonNullable<SurnameProfile["ine"]>> {
  const normalizedSurname = normalizePlaceName(surname).toLocaleUpperCase("es");
  const sourceUrl = ineSurnameWidgetUrl();
  const totals = await fetchIneJson<Array<{
    Resultado?: string;
    Series?: Array<{
      Apellido?: string;
      Total1?: number;
      Total2?: number;
      Total3?: number;
      Porcentaje1?: number;
      Porcentaje2?: number;
      Porcentaje3?: number;
    }>;
  }>>(`/apellidos/widget?apellido=${encodeURIComponent(normalizedSurname)}`);
  const series = totals[0]?.Series?.[0];
  if (!series || totals[0]?.Resultado === "No hay resultados") throw new Error("INE surname not found");

  const [provinceFirst, provinceSecond, provinceBoth] = await Promise.all([
    fetchIneSurnameProvinceDistribution(normalizedSurname, 1),
    fetchIneSurnameProvinceDistribution(normalizedSurname, 2),
    fetchIneSurnameProvinceDistribution(normalizedSurname, 3)
  ]);

  return {
    surname: series.Apellido || normalizedSurname,
    totalFirst: Number(series.Total1) || undefined,
    totalSecond: Number(series.Total2) || undefined,
    totalBoth: Number(series.Total3) || undefined,
    frequencyFirst: Number(series.Porcentaje1) || undefined,
    frequencySecond: Number(series.Porcentaje2) || undefined,
    frequencyBoth: Number(series.Porcentaje3) || undefined,
    provinceFirst,
    provinceSecond,
    provinceBoth,
    sourceName: "INE",
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchIneSurnameProvinceDistribution(surname: string, type: 1 | 2 | 3) {
  const data = await fetchIneJson<{ regiones?: Array<{ id: number; val: number; unidad: string }> }>(
    `/apellidos/mapaWidget?apellido=${encodeURIComponent(surname)}&tipo=${type}`
  ).catch(() => ({ regiones: [] }));

  return (data.regiones ?? [])
    .filter((region) => provinceNamesByIneId[region.id])
    .map((region) => ({
      id: region.id,
      name: provinceNamesByIneId[region.id],
      value: Number(region.val),
      unit: region.unidad
    }))
    .sort((first, second) => second.value - first.value);
}

async function fetchIneJson<T>(path: string): Promise<T> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<T>("fetch_ine_json", { path });
  }

  const response = await fetch(`/ine-api${path}`);
  if (!response.ok) throw new Error(`INE request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function fetchForebearsSurnameStats(surname: string): Promise<NonNullable<SurnameProfile["forebears"]>> {
  const url = forebearsSurnameUrl(surname);
  const html = await fetchForebearsHtml(new URL(url).pathname);
  return parseForebearsSurnameHtml(surname, url, html);
}

async function fetchForebearsHtml(path: string): Promise<string> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<string>("fetch_forebears_html", { path });
  }

  const response = await fetch(`/forebears-api${path}`);
  if (!response.ok) throw new Error(`Forebears request failed: ${response.status}`);
  return response.text();
}

async function fetchGeneanetHtml(path: string): Promise<string> {
  const sourceUrl = `https://es.geneanet.org${path}`;
  const attempts: Array<() => Promise<string>> = [];

  if ("__TAURI_INTERNALS__" in window) {
    attempts.push(() => invoke<string>("fetch_geneanet_html", { path }));
  } else {
    attempts.push(async () => {
      const response = await fetch(`/geneanet-api${path}`);
      if (!response.ok) throw new Error(`Geneanet request failed: ${response.status}`);
      return response.text();
    });
  }

  attempts.push(
    async () => {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Geneanet direct request failed: ${response.status}`);
      return response.text();
    },
    async () => {
      const response = await fetch(`https://r.jina.ai/http://${sourceUrl}`);
      if (!response.ok) throw new Error(`Geneanet reader request failed: ${response.status}`);
      return response.text();
    },
    async () => {
      const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(sourceUrl)}`);
      if (!response.ok) throw new Error(`Geneanet fallback request failed: ${response.status}`);
      return response.text();
    }
  );

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const html = await attempt();
      if (html && !/Just a moment|Enable JavaScript and cookies|cf_chl/i.test(html)) {
        return html;
      }
      lastError = new Error("Geneanet returned a blocking page");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Geneanet request failed");
}

async function fetchBehindTheNameHtml(path: string): Promise<string> {
  const sourceUrl = `https://www.behindthename.com${path}`;
  const attempts: Array<() => Promise<string>> = [];

  if ("__TAURI_INTERNALS__" in window) {
    attempts.push(() => invoke<string>("fetch_behind_the_name_html", { path }));
  } else {
    attempts.push(async () => {
      const response = await fetch(`/behindthename-api${path}`);
      if (!response.ok) throw new Error(`Behind the Name request failed: ${response.status}`);
      return response.text();
    });
  }

  attempts.push(
    async () => {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Behind the Name direct request failed: ${response.status}`);
      return response.text();
    },
    async () => {
      const response = await fetch(`https://r.jina.ai/http://${sourceUrl}`);
      if (!response.ok) throw new Error(`Behind the Name reader request failed: ${response.status}`);
      return response.text();
    }
  );

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      const html = await attempt();
      if (html && !/Just a moment|Enable JavaScript and cookies|cf_chl/i.test(html)) {
        return html;
      }
      lastError = new Error("Behind the Name returned a blocking page");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Behind the Name request failed");
}

function parseForebearsSurnameHtml(
  surname: string,
  sourceUrl: string,
  html: string
): NonNullable<SurnameProfile["forebears"]> {
  if (/Just a moment|Enable JavaScript and cookies|cf_chl/i.test(html)) {
    throw new Error("Forebears blocked automated request");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const text = document.body.textContent?.replace(/\u00a0/g, " ") ?? "";
  const normalizedText = text.replace(/[ \t]+/g, " ");
  const countries = extractForebearsCountryRows(text);
  const rankMatch = normalizedText.match(/([\d,]+)(?:st|nd|rd|th)\s+Most Common/i);
  const totalMatch = normalizedText.match(/Approximately\s+([\d,]+)\s+people bear this surname/i);
  const mostPrevalentCountry = extractForebearsCountryAfterLabel(normalizedText, "Most prevalent in:");
  const highestDensityCountry = extractForebearsCountryAfterLabel(normalizedText, "Highest density in:");
  const prevalentMatch = normalizedText.match(/Most prevalent in:\s*([A-Za-zÀ-ÿ .'-]+)/i);
  const densityMatch = normalizedText.match(/Highest density in:\s*([A-Za-zÀ-ÿ .'-]+)/i);

  if (!totalMatch && countries.length === 0) {
    throw new Error("Forebears surname data not found");
  }

  return {
    surname,
    worldRank: parseInteger(rankMatch?.[1]),
    totalWorld: parseInteger(totalMatch?.[1]),
    mostPrevalentCountry: cleanCountryName(mostPrevalentCountry),
    highestDensityCountry: cleanCountryName(highestDensityCountry),
    countries: countries.map((country) => ({ ...country, country: cleanCountryName(country.country) || country.country })),
    sourceName: "Forebears",
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

function extractForebearsCountryRows(text: string) {
  const rows: NonNullable<SurnameProfile["forebears"]>["countries"] = [];
  const rowPattern = /^([A-Za-zÀ-ÿ .'-]+?)\s+([\d,]+)\s+(1:[\d,]+)\s+([\d,]+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = rowPattern.exec(text)) && rows.length < 20) {
    rows.push({
      country: match[1].trim(),
      incidence: parseInteger(match[2]),
      frequency: match[3],
      rank: parseInteger(match[4])
    });
  }

  return rows;
}

function extractForebearsCountryAfterLabel(text: string, label: string) {
  const labelIndex = text.toLowerCase().indexOf(label.toLowerCase());
  if (labelIndex < 0) return undefined;

  return cleanCountryName(text.slice(labelIndex + label.length, labelIndex + label.length + 120));
}

function cleanCountryName(value?: string) {
  const cleanedValue = (value ?? "")
    .replace(/Surname Definition:.*$/is, "")
    .replace(/Read More.*$/is, "")
    .replace(/Approximately.*$/is, "")
    .replace(/Most Common.*$/is, "")
    .replace(/Highest Density.*$/is, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedValue = normalizePlaceName(cleanedValue).replace(/\s+/g, "");
  if (!normalizedValue) return "";

  const match = Object.keys(countryFlagFiles)
    .sort((first, second) => second.length - first.length)
    .find((country) => normalizedValue.startsWith(normalizePlaceName(country).replace(/\s+/g, "")));

  if (match) return match;

  const readableCountry = cleanedValue.match(/^[A-Za-zÀ-ÿ .'-]+/)?.[0]?.trim() ?? "";
  return readableCountry.replace(/[.,;:]+$/, "");
}

function countryFlagUrl(country: string) {
  const cleanCountry = cleanCountryName(country);
  const fileName = countryFlagFiles[cleanCountry];
  return fileName ? wikimediaFlagUrl(fileName) : "";
}

function parseInteger(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ineSurnameWidgetUrl() {
  return `https://www.ine.es/widgets/nombApell/index.shtml`;
}

function forebearsSurnameUrl(surname: string) {
  return `https://forebears.io/surnames/${slugifySurnameForUrl(surname)}`;
}

function geneanetSurnameUrl(surname: string) {
  return `https://es.geneanet.org/apellidos/${slugifyGeneanetSurname(surname)}`;
}

function heraldicaFamiliarSurnameUrl(surname: string) {
  return `https://www.heraldicafamiliar.com/${slugifyHeraldicaSurname(surname)}/`;
}

function slugifyGeneanetSurname(surname: string) {
  return surname
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyHeraldicaSurname(surname: string) {
  return surname
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchHeraldicaFamiliarCoatOfArms(surname: string): Promise<Partial<SurnameProfile>> {
  const sourceUrl = heraldicaFamiliarSurnameUrl(surname);
  return {
    coatOfArmsUrl: heraldicaFamiliarCoatOfArmsImageUrl(surname),
    coatOfArmsSourceUrl: sourceUrl,
    coatOfArmsFetchedAt: new Date().toISOString()
  };
}

function heraldicaFamiliarCoatOfArmsImageUrl(surname: string) {
  return `https://www.heraldicafamiliar.com/objetos/escudos/${toHeraldicaImageName(surname)}.webp`;
}

function toHeraldicaImageName(surname: string) {
  return surname
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toLocaleUpperCase("es") + part.slice(1).toLocaleLowerCase("es"))
    .join("-");
}

async function fetchHeraldicaFamiliarText(sourceUrl: string) {
  try {
    const readerResponse = await fetch(`https://r.jina.ai/http://${sourceUrl}`);
    if (readerResponse.ok) {
      const text = await readerResponse.text();
      if (!isBlockedHeraldicaResponse(text)) return text;
    }
  } catch {
    // Try the public page directly; some local runtimes allow it where the reader proxy does not.
  }

  const directResponse = await fetch(sourceUrl);
  if (!directResponse.ok) throw new Error(`Heraldica Familiar request failed: ${directResponse.status}`);
  const directText = await directResponse.text();
  if (isBlockedHeraldicaResponse(directText)) throw new Error("Heraldica Familiar returned a challenge page");
  return directText;
}

function isBlockedHeraldicaResponse(text: string) {
  return /robot challenge|checking the site connection|captcha|403\s*-\s*forbidden/i.test(text);
}

function parseHeraldicaFamiliarCoatOfArmsUrl(text: string, surname: string) {
  const normalizedSurname = normalizePlaceName(surname);
  const imagePattern = /!\[([^\]]*)]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  let fallback = "";

  while ((match = imagePattern.exec(text))) {
    const alt = normalizePlaceName(match[1]);
    const url = match[2].trim();
    if (!/escudo|armas|apellido/.test(alt)) continue;
    if (!fallback) fallback = url;
    if (alt.includes(normalizedSurname)) return url;
  }

  if (fallback) return fallback;

  const document = new DOMParser().parseFromString(text, "text/html");
  const image = Array.from(document.querySelectorAll("img")).find((element) => {
    const alt = normalizePlaceName(element.getAttribute("alt") ?? "");
    return /escudo|armas|apellido/.test(alt) && (!normalizedSurname || alt.includes(normalizedSurname));
  });
  const imageSource =
    image?.getAttribute("src") ||
    image?.getAttribute("data-src") ||
    image?.getAttribute("data-lazy-src") ||
    image?.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ||
    "";

  return imageSource ? new URL(imageSource, heraldicaFamiliarSurnameUrl(surname)).toString() : "";
}

async function fetchFirstNameMeaningProfile(name: string): Promise<GivenNameProfile> {
  try {
    return await fetchAncestryFirstNameMeaning(name);
  } catch (ancestryError) {
    try {
      return await fetchBehindTheNameMeaning(name);
    } catch {
      throw ancestryError;
    }
  }
}

async function fetchAncestryFirstNameMeaning(name: string): Promise<GivenNameProfile> {
  const cleanName = extractFirstGivenName(name);
  if (!cleanName) throw new Error("Name is empty");

  const sourceUrl = ancestryFirstNameUrl(cleanName);
  const html = await fetchAncestryFirstNameHtml(cleanName);
  const meaning = parseAncestryFirstNameMeaning(html, cleanName);
  if (!meaning) throw new Error("Ancestry name meaning not found");

  return {
    name: cleanName,
    meaning,
    originalMeaning: meaning,
    sourceName: "Ancestry",
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchAncestryFirstNameHtml(name: string) {
  const sourceUrl = ancestryFirstNameUrl(name);
  const response = await fetch(`https://r.jina.ai/http://${sourceUrl}`);
  if (!response.ok) throw new Error(`Ancestry first name request failed: ${response.status}`);
  return response.text();
}

function ancestryFirstNameUrl(name: string) {
  return `https://www.ancestry.com/first-name-meaning/${slugifyAncestryFirstName(name)}?geo-lang=es`;
}

function slugifyAncestryFirstName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseAncestryFirstNameMeaning(markdown: string, name: string) {
  const body = markdown.split("Markdown Content:").pop() ?? markdown;
  const stopPatterns = [
    "\n## Según nuestros registros",
    "\n## Segun nuestros registros",
    "\n## Países principales",
    "\n## Paises principales",
    "\n## ¿Qué te da curiosidad?",
    "\n## Explora el origen"
  ];
  const stopIndex = stopPatterns
    .map((pattern) => body.indexOf(pattern))
    .filter((index) => index >= 0)
    .sort((first, second) => first - second)[0];
  const mainText = stopIndex >= 0 ? body.slice(0, stopIndex) : body;
  const cleaned = cleanAncestryFirstNameText(mainText, name);
  return compactParagraphs(cleaned, 150);
}

function cleanAncestryFirstNameText(value: string, name: string) {
  const normalizedName = normalizePlaceName(name);
  const lines = value
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Title:/i.test(line))
    .filter((line) => !/^URL Source:/i.test(line))
    .filter((line) => !/^Este contenido se tradujo/i.test(line))
    .filter((line) => !normalizePlaceName(line).startsWith("segun nuestros registros"))
    .filter((line) => normalizePlaceName(line) !== normalizedName);

  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchBehindTheNameMeaning(name: string): Promise<GivenNameProfile> {
  const cleanName = extractFirstGivenName(name);
  if (!cleanName) throw new Error("Name is empty");

  const candidates = await fetchBehindTheNamePages(cleanName);
  const match = candidates.find((page) => parseBehindTheNameMeaning(page.html));
  const sourceUrl = match?.sourceUrl;
  const originalMeaning = match ? parseBehindTheNameMeaning(match.html) : "";
  if (!sourceUrl || !originalMeaning) throw new Error("Behind the Name meaning not found");

  const meaning = (await translateTextToSpanish(originalMeaning, "en")) || translateBehindTheNameMeaningLocally(originalMeaning);
  if (!meaning) throw new Error("Name meaning translation failed");

  return {
    name: cleanName,
    meaning,
    originalMeaning,
    sourceName: "Behind the Name",
    sourceUrl,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchBehindTheNamePages(name: string) {
  const slugs = uniqueIds([slugifyBehindTheName(name), `${slugifyBehindTheName(name)}-1`]).filter(Boolean);
  const pages: Array<{ html: string; sourceUrl: string }> = [];

  for (const slug of slugs) {
    try {
      pages.push({
        html: await fetchBehindTheNameHtml(`/name/${slug}`),
        sourceUrl: `https://www.behindthename.com/name/${slug}`
      });
    } catch {
      // Try the next known Behind the Name slug variant.
    }
  }

  if (pages.length === 0) throw new Error("Behind the Name page not found");
  return pages;
}

function parseBehindTheNameMeaning(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const directDefinition = document.querySelector(".namepage .namedef, .namedef");
  if (directDefinition?.textContent?.trim()) {
    return compactExcerpt(cleanBehindTheNameText(directDefinition.textContent), 130);
  }

  const heading = Array.from(document.querySelectorAll("h2, h3")).find((element) =>
    normalizePlaceName(element.textContent ?? "").includes("meaning history")
  );

  const definition = heading?.closest("section")?.querySelector(".namedef");
  if (definition?.textContent?.trim()) {
    return compactExcerpt(cleanBehindTheNameText(definition.textContent), 130);
  }

  const markdownMeaning = extractBehindTheNameMarkdownMeaning(html);
  if (markdownMeaning) return compactExcerpt(markdownMeaning, 130);
  if (!heading) return "";

  const parts: string[] = [];
  let current = heading.closest(".nameheading")?.nextElementSibling ?? heading.nextElementSibling;
  while (current && !/^H[23]$/.test(current.tagName) && parts.join(" ").length < 1200) {
    const text = cleanBehindTheNameText(current.textContent ?? "");
    if (text) parts.push(text);
    current = current.nextElementSibling;
  }

  return compactExcerpt(parts.join(" "), 130);
}

function extractBehindTheNameMarkdownMeaning(value: string) {
  const match = value.match(
    /(?:^|\n)\s*#{1,4}\s*Meaning\s*&\s*History\s*\n+(?:\[[^\]]+]\([^)]+\)\s*\n+)?(.+?)(?=\n+\s*#{1,4}\s+)/is
  );

  return cleanBehindTheNameText(match?.[1] ?? "");
}

function cleanBehindTheNameText(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/Expand Links/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function behindTheNameUrl(name: string) {
  return `https://www.behindthename.com/name/${slugifyBehindTheName(name)}`;
}

function slugifyBehindTheName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchSurnameOriginSuggestions(surname: string): Promise<NonNullable<SurnameProfile["originSuggestions"]>> {
  const [wikipedia, wikidata, translatedWikipedia] = await Promise.all([
    fetchWikipediaOriginSuggestion(surname, "es").catch(() => null),
    fetchWikidataOriginSuggestion(surname).catch(() => null),
    fetchTranslatedWikipediaOriginSuggestion(surname, "en").catch(() => null)
  ]);

  const suggestions = [wikipedia, wikidata, translatedWikipedia].filter(
    (suggestion): suggestion is NonNullable<SurnameProfile["originSuggestions"]>[number] => Boolean(suggestion)
  ).filter((suggestion) => suggestion.language === "es");
  const unique = new Map<string, NonNullable<SurnameProfile["originSuggestions"]>[number]>();
  suggestions.forEach((suggestion) => {
    unique.set(`${suggestion.sourceName}-${suggestion.sourceUrl}`, suggestion);
  });

  return [...unique.values()];
}

async function fetchGeneanetSurnameMeaningSuggestion(
  surname: string
): Promise<NonNullable<SurnameProfile["originSuggestions"]>[number] | null> {
  const sourceUrl = geneanetSurnameUrl(surname);
  const html = await fetchGeneanetHtml(new URL(sourceUrl).pathname);
  const excerpt = parseGeneanetSurnameMeaning(html, surname);
  if (!excerpt) return null;

  return {
    id: createId("origin"),
    sourceName: "Geneanet",
    sourceUrl,
    title: `Significado del apellido ${toTitleCase(surname)}`,
    meaning: excerpt,
    excerpt,
    language: "es",
    status: "pending",
    fetchedAt: new Date().toISOString()
  };
}

function parseGeneanetSurnameMeaning(html: string, surname: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const heading = Array.from(document.querySelectorAll("h2, h3")).find((element) =>
    normalizePlaceName(element.textContent ?? "") === "origen"
  );
  const parts: string[] = [];
  let current = heading?.nextElementSibling ?? null;

  while (current && !/^H[23]$/.test(current.tagName) && parts.join(" ").length < 900) {
    const text = cleanGeneanetText(current.textContent ?? "");
    if (text && !/^compartir/i.test(text) && !/^fuente/i.test(text)) {
      parts.push(text);
    }
    current = current.nextElementSibling;
  }

  const directText = compactExcerpt(cleanGeneanetMeaningForSurname(parts.join(" "), surname), 70);
  if (directText) return directText;

  const pageText = html.includes("Markdown Content:")
    ? normalizeGeneanetTextLines(html)
    : normalizeGeneanetTextLines(document.body.textContent ?? "");
  const originBlock = extractGeneanetOriginBlock(pageText);
  if (originBlock) return compactExcerpt(cleanGeneanetMeaningForSurname(originBlock, surname), 70);

  const metaDescription = cleanGeneanetOriginText(
    document.querySelector('meta[name="description"]')?.getAttribute("content") ?? ""
  );
  if (metaDescription && metaDescription.includes(":")) {
    return compactExcerpt(cleanGeneanetMeaningForSurname(metaDescription, surname), 70);
  }

  return "";
}

function extractGeneanetOriginBlock(value: string) {
  const match = value.match(
    /(?:^|\n)\s*(?:#{1,4}\s*)?Origen\s*\n+(.+?)(?=\n+\s*(?:Compartir\s*:|_?Fuente\s*:|#{1,4}\s+Popularidad|Popularidad del apellido))/is
  );

  return cleanGeneanetOriginText(match?.[1] ?? "");
}

function normalizeGeneanetTextLines(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanGeneanetText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+:/g, ":")
    .trim();
}

function cleanGeneanetOriginText(value: string) {
  return cleanGeneanetText(value)
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_`#]+/g, "")
    .replace(/^,+/, "")
    .replace(/^Origen,\s*popularidad y significado del apellido\s+[A-ZÀ-ÿ0-9 -]+\s+/i, "")
    .replace(/^Volver\s+/i, "")
    .replace(/^Origen\s+/i, "")
    .trim();
}

function cleanGeneanetMeaningForSurname(value: string, surname: string) {
  const cleaned = cleanGeneanetOriginText(value);
  if (!cleaned) return "";

  const normalizedSurname = normalizePlaceName(surname).replace(/\s+/g, "");
  const firstHeaderMatch = cleaned.match(/^([A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{1,45}):\s*/);
  let focused = cleaned;

  if (firstHeaderMatch) {
    const normalizedHeader = normalizePlaceName(firstHeaderMatch[1]).replace(/\s+/g, "");
    if (normalizedHeader && normalizedHeader !== normalizedSurname) {
      const exactHeaderPattern = new RegExp(`\\b${escapeRegExp(surname)}\\s*:`, "i");
      const exactHeaderMatch = cleaned.match(exactHeaderPattern);
      if (exactHeaderMatch?.index !== undefined) {
        focused = cleaned.slice(exactHeaderMatch.index);
      }
    }
  }

  const originMatch = focused.match(
    /Origen:\s*(España|Portugal|Alemania|Francia|Italia|Inglaterra|Irlanda|Escocia|Países Bajos|Bélgica|Suiza|Austria|Polonia|Rusia|Estados Unidos|México|Argentina|Colombia|Perú|Chile|Brasil|Cuba|Puerto Rico|Uruguay|Venezuela)/i
  );
  if (originMatch?.index !== undefined) {
    focused = focused.slice(0, originMatch.index + originMatch[0].length);
  } else {
    focused = focused.replace(
      /\s+(?:De\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{1,45}:\s+.*$/s,
      ""
    );
  }

  return focused
    .replace(/\s*Origen:\s*/i, "\nOrigen: ")
    .replace(/\s+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

function needsSurnameMeaningRefresh(value: string | undefined, surname: string) {
  const trimmed = value?.trim();
  if (!trimmed) return true;

  const cleaned = cleanGeneanetMeaningForSurname(trimmed, surname);
  if (!cleaned) return true;
  if (cleaned.length < Math.min(60, trimmed.length * 0.45)) return true;

  const originCount = (trimmed.match(/Origen:/gi) ?? []).length;
  if (originCount > 1) return true;

  const headerCount = (trimmed.match(/\b(?:De\s+)?[A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{1,45}:\s+/g) ?? []).length;
  return headerCount > 1;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchTranslatedWikipediaOriginSuggestion(
  surname: string,
  sourceLanguage: string
): Promise<NonNullable<SurnameProfile["originSuggestions"]>[number] | null> {
  const originalSuggestion = await fetchWikipediaOriginSuggestion(surname, sourceLanguage);
  if (!originalSuggestion?.excerpt) return null;

  const translatedExcerpt = await translateTextToSpanish(originalSuggestion.excerpt, sourceLanguage);
  if (!translatedExcerpt || isLikelyEnglishText(translatedExcerpt)) return null;

  return {
    ...originalSuggestion,
    id: createId("origin"),
    title: `${originalSuggestion.title} (traducido)`,
    origin: extractOriginText(translatedExcerpt),
    meaning: extractMeaningText(translatedExcerpt),
    excerpt: translatedExcerpt,
    language: "es"
  };
}

async function fetchWikipediaOriginSuggestion(
  surname: string,
  language: string
): Promise<NonNullable<SurnameProfile["originSuggestions"]>[number] | null> {
  const query = language === "es" ? `${surname} apellido` : `${surname} surname`;
  const searchUrl = `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&origin=*`;
  const searchResponse = await fetch(searchUrl);
  if (!searchResponse.ok) return null;

  const searchData = (await searchResponse.json()) as { query?: { search?: Array<{ title: string }> } };
  const pageTitle = searchData.query?.search?.[0]?.title;
  if (!pageTitle) return null;

  const summaryUrl = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  const summaryResponse = await fetch(summaryUrl);
  if (!summaryResponse.ok) return null;

  const summary = (await summaryResponse.json()) as {
    title?: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  const excerpt = compactExcerpt(summary.extract);
  if (!excerpt) return null;

  return {
    id: createId("origin"),
    sourceName: "Wikipedia",
    sourceUrl: summary.content_urls?.desktop?.page ?? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(pageTitle)}`,
    title: summary.title ?? pageTitle,
    origin: extractOriginText(excerpt),
    meaning: extractMeaningText(excerpt),
    excerpt,
    language,
    status: "pending",
    fetchedAt: new Date().toISOString()
  };
}

async function fetchWikidataOriginSuggestion(
  surname: string
): Promise<NonNullable<SurnameProfile["originSuggestions"]>[number] | null> {
  const language = "es";
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
    surname
  )}&language=${language}&uselang=${language}&format=json&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    search?: Array<{ id: string; label?: string; description?: string; concepturi?: string }>;
  };
  const result = data.search?.find((item) => {
    const description = normalizePlaceName(item.description ?? "");
    return /apellido|surname|family name/.test(description);
  }) ?? data.search?.[0];
  const excerpt = compactExcerpt(result?.description);
  if (!result || !excerpt) return null;

  return {
    id: createId("origin"),
    sourceName: "Wikidata",
    sourceUrl: result.concepturi ?? `https://www.wikidata.org/wiki/${result.id}`,
    title: result.label ?? surname,
    origin: excerpt,
    meaning: excerpt,
    excerpt,
    language,
    status: "pending",
    fetchedAt: new Date().toISOString()
  };
}

function compactExcerpt(value?: string, maxWords = 70) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, maxWords)
    .join(" ");
}

function compactParagraphs(value?: string, maxWords = 120) {
  let remaining = maxWords;
  const paragraphs: string[] = [];

  (value ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .forEach((paragraph) => {
      if (remaining <= 0) return;
      const words = paragraph.split(" ");
      paragraphs.push(words.slice(0, remaining).join(" "));
      remaining -= words.length;
    });

  return paragraphs.join("\n\n").trim();
}

async function translateTextToSpanish(text: string, sourceLanguage: string) {
  const cleanText = compactExcerpt(text, 85).trim();
  if (!cleanText) return "";

  try {
    const path = `/get?q=${encodeURIComponent(cleanText)}&langpair=${encodeURIComponent(
      `${sourceLanguage}|es`
    )}`;
    const data = await fetchTranslationJson<{
      responseData?: {
        translatedText?: string;
      };
    }>(path);
    return compactExcerpt(data.responseData?.translatedText);
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string) {
  if (!value) return "";
  const element = document.createElement("textarea");
  element.innerHTML = value;
  return element.value;
}

async function fetchTranslationJson<T>(path: string): Promise<T> {
  if ("__TAURI_INTERNALS__" in window) {
    return invoke<T>("fetch_translation_json", { path });
  }

  const response = await fetch(`/translate-api${path}`);
  if (!response.ok) throw new Error(`Translation request failed: ${response.status}`);
  return (await response.json()) as T;
}

function translateBehindTheNameMeaningLocally(text: string) {
  const clean = cleanBehindTheNameText(text);
  if (!clean) return "";

  let translated = clean
    .replace(/\bItalian\b/g, "italiana")
    .replace(/\bSpanish\b/g, "española")
    .replace(/\bPortuguese\b/g, "portuguesa")
    .replace(/\bCatalan\b/g, "catalana")
    .replace(/\bFrench\b/g, "francesa")
    .replace(/\bEnglish\b/g, "inglesa")
    .replace(/\bGerman\b/g, "alemana")
    .replace(/\bDutch\b/g, "neerlandesa")
    .replace(/\bRussian\b/g, "rusa")
    .replace(/\bGreek\b/g, "griega")
    .replace(/\bLatin\b/g, "latina")
    .replace(/\bHebrew\b/g, "hebrea")
    .replace(/\bArabic\b/g, "árabe")
    .replace(/\bBasque\b/g, "vasca")
    .replace(/\bGalician\b/g, "gallega")
    .replace(/\bform of\b/gi, "forma de")
    .replace(/\bforms of\b/gi, "formas de")
    .replace(/\bvariant of\b/gi, "variante de")
    .replace(/\bdiminutive of\b/gi, "diminutivo de")
    .replace(/\bfeminine form of\b/gi, "forma femenina de")
    .replace(/\bmasculine form of\b/gi, "forma masculina de")
    .replace(/\bderived from\b/gi, "derivado de")
    .replace(/\bpossibly derived from\b/gi, "posiblemente derivado de")
    .replace(/\bmeans\b/gi, "significa")
    .replace(/\bmeaning\b/gi, "significado")
    .replace(/\bfrom the\b/gi, "del")
    .replace(/\bfrom\b/gi, "de")
    .replace(/\band\b/g, "y")
    .replace(/\bor\b/g, "o");

  translated = translated.replace(/^([a-záéíóúñ]+(?:,\s*[a-záéíóúñ]+)*(?:\s+y\s+[a-záéíóúñ]+)?) forma de/i, "Forma $1 de");

  return compactExcerpt(translated, 85);
}

function isLikelyEnglishText(text: string) {
  const normalized = ` ${normalizePlaceName(text)} `;
  const englishMarkers = [" the ", " surname ", " derived ", " meaning ", " origin ", " from ", " family name "];
  const spanishMarkers = [" el ", " la ", " apellido ", " deriva ", " significa ", " origen ", " de "];
  const englishScore = englishMarkers.filter((marker) => normalized.includes(marker)).length;
  const spanishScore = spanishMarkers.filter((marker) => normalized.includes(marker)).length;
  return englishScore > spanishScore;
}

function extractOriginText(excerpt: string) {
  const sentences = excerpt.match(/[^.!?]+[.!?]?/g) ?? [excerpt];
  return (
    sentences.find((sentence) =>
      /origen|origin|deriva|derived|proviene|comes from|topon[ií]mico|patron[ií]mico|surname|apellido/i.test(sentence)
    ) ?? excerpt
  ).trim();
}

function extractMeaningText(excerpt: string) {
  const sentences = excerpt.match(/[^.!?]+[.!?]?/g) ?? [excerpt];
  return (
    sentences.find((sentence) => /significa|meaning|means|derived|deriva|proviene/i.test(sentence)) ?? ""
  ).trim();
}

function slugifySurnameForUrl(surname: string) {
  return surname
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


function formatNumber(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "Sin dato";
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 }).format(value);
}

function formatThousands(value?: number) {
  if (value === undefined || Number.isNaN(value)) return "Sin dato";
  return `${new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 1
  }).format(value / 1000)} K`;
}

function formatDecimalNumber(value?: number, digits = 1) {
  if (value === undefined || Number.isNaN(value)) return "Sin dato";
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function getSpanishSurnameFrequencyValue(total: number, t: Record<string, string>) {
  if (total < 10000) return t.lowFrequencySurname;
  if (total > 100000) return t.highFrequencySurname;
  return t.normalFrequencySurname;
}

function formatDateShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES").format(date);
}

const brightStars = [
  { id: "sirius", name: "Sirio", ra: 6.7525, dec: -16.7161, mag: -1.46 },
  { id: "canopus", name: "Canopo", ra: 6.3992, dec: -52.6957, mag: -0.74 },
  { id: "arcturus", name: "Arturo", ra: 14.261, dec: 19.1825, mag: -0.05 },
  { id: "vega", name: "Vega", ra: 18.6156, dec: 38.7837, mag: 0.03 },
  { id: "capella", name: "Capella", ra: 5.2782, dec: 45.998, mag: 0.08 },
  { id: "rigel", name: "Rigel", ra: 5.2423, dec: -8.2016, mag: 0.13 },
  { id: "procyon", name: "Procyon", ra: 7.655, dec: 5.225, mag: 0.34 },
  { id: "betelgeuse", name: "Betelgeuse", ra: 5.9195, dec: 7.4071, mag: 0.5 },
  { id: "achernar", name: "Achernar", ra: 1.6286, dec: -57.2368, mag: 0.46 },
  { id: "altair", name: "Altair", ra: 19.8464, dec: 8.8683, mag: 0.77 },
  { id: "aldebaran", name: "Aldebarán", ra: 4.5987, dec: 16.5093, mag: 0.85 },
  { id: "antares", name: "Antares", ra: 16.4901, dec: -26.432, mag: 1.06 },
  { id: "spica", name: "Espiga", ra: 13.4199, dec: -11.1614, mag: 0.98 },
  { id: "pollux", name: "Pólux", ra: 7.7553, dec: 28.0262, mag: 1.14 },
  { id: "fomalhaut", name: "Fomalhaut", ra: 22.9608, dec: -29.6222, mag: 1.16 },
  { id: "deneb", name: "Deneb", ra: 20.6905, dec: 45.2803, mag: 1.25 },
  { id: "regulus", name: "Régulo", ra: 10.1395, dec: 11.9672, mag: 1.35 },
  { id: "castor", name: "Cástor", ra: 7.5767, dec: 31.8883, mag: 1.58 },
  { id: "bellatrix", name: "Bellatrix", ra: 5.4189, dec: 6.3497, mag: 1.64 },
  { id: "elnath", name: "Elnath", ra: 5.4382, dec: 28.6075, mag: 1.65 },
  { id: "alnilam", name: "Alnilam", ra: 5.6036, dec: -1.2019, mag: 1.69 },
  { id: "alnitak", name: "Alnitak", ra: 5.6793, dec: -1.9426, mag: 1.74 },
  { id: "mintaka", name: "Mintaka", ra: 5.5334, dec: -0.2991, mag: 2.23 },
  { id: "saiph", name: "Saiph", ra: 5.7959, dec: -9.6696, mag: 2.06 },
  { id: "dubhe", name: "Dubhe", ra: 11.0621, dec: 61.751, mag: 1.79 },
  { id: "merak", name: "Merak", ra: 11.0307, dec: 56.3824, mag: 2.37 },
  { id: "phecda", name: "Phecda", ra: 11.8972, dec: 53.6948, mag: 2.44 },
  { id: "megrez", name: "Megrez", ra: 12.2571, dec: 57.0326, mag: 3.31 },
  { id: "alioth", name: "Alioth", ra: 12.9005, dec: 55.9598, mag: 1.76 },
  { id: "mizar", name: "Mizar", ra: 13.3987, dec: 54.9254, mag: 2.23 },
  { id: "alkaid", name: "Alkaid", ra: 13.7923, dec: 49.3133, mag: 1.85 },
  { id: "schedar", name: "Schedar", ra: 0.6751, dec: 56.5373, mag: 2.24 },
  { id: "caph", name: "Caph", ra: 0.1529, dec: 59.1498, mag: 2.28 },
  { id: "mirach", name: "Mirach", ra: 1.1622, dec: 35.6206, mag: 2.05 },
  { id: "alpheratz", name: "Alpheratz", ra: 0.1398, dec: 29.0904, mag: 2.07 }
] as const;

const constellationLines = [
  ["rigel", "alnitak"],
  ["alnitak", "alnilam"],
  ["alnilam", "mintaka"],
  ["mintaka", "bellatrix"],
  ["bellatrix", "betelgeuse"],
  ["betelgeuse", "alnitak"],
  ["rigel", "saiph"],
  ["saiph", "alnitak"],
  ["dubhe", "merak"],
  ["merak", "phecda"],
  ["phecda", "megrez"],
  ["megrez", "alioth"],
  ["alioth", "mizar"],
  ["mizar", "alkaid"],
  ["caph", "schedar"],
  ["schedar", "mirach"],
  ["mirach", "alpheratz"],
  ["alpheratz", "caph"],
  ["vega", "deneb"],
  ["deneb", "altair"],
  ["altair", "vega"]
] as const;

const provinceNamesByIneId: Record<number, string> = {
  1: "Álava",
  2: "Albacete",
  3: "Alicante/Alacant",
  4: "Almería",
  5: "Ávila",
  6: "Badajoz",
  7: "Illes Balears",
  8: "Barcelona",
  9: "Burgos",
  10: "Cáceres",
  11: "Cádiz",
  12: "Castellón/Castelló",
  13: "Ciudad Real",
  14: "Córdoba",
  15: "A Coruña",
  16: "Cuenca",
  17: "Girona",
  18: "Granada",
  19: "Guadalajara",
  20: "Gipuzkoa",
  21: "Huelva",
  22: "Huesca",
  23: "Jaén",
  24: "León",
  25: "Lleida",
  26: "La Rioja",
  27: "Lugo",
  28: "Madrid",
  29: "Málaga",
  30: "Murcia",
  31: "Navarra",
  32: "Ourense",
  33: "Asturias",
  34: "Palencia",
  35: "Las Palmas",
  36: "Pontevedra",
  37: "Salamanca",
  38: "Santa Cruz de Tenerife",
  39: "Cantabria",
  40: "Segovia",
  41: "Sevilla",
  42: "Soria",
  43: "Tarragona",
  44: "Teruel",
  45: "Toledo",
  46: "Valencia/València",
  47: "Valladolid",
  48: "Bizkaia",
  49: "Zamora",
  50: "Zaragoza",
  51: "Ceuta",
  52: "Melilla"
};

const countryFlagFiles: Record<string, string> = {
  Andorra: "Flag of Andorra.svg",
  Argentina: "Flag of Argentina.svg",
  Austria: "Flag of Austria.svg",
  Azerbaijan: "Flag of Azerbaijan.svg",
  Belgium: "Flag of Belgium.svg",
  Bolivia: "Flag of Bolivia.svg",
  Brazil: "Flag of Brazil.svg",
  Canada: "Flag of Canada.svg",
  Chile: "Flag of Chile.svg",
  China: "Flag of the People's Republic of China.svg",
  Colombia: "Flag of Colombia.svg",
  "Costa Rica": "Flag of Costa Rica.svg",
  Cuba: "Flag of Cuba.svg",
  Ecuador: "Flag of Ecuador.svg",
  "El Salvador": "Flag of El Salvador.svg",
  England: "Flag of England.svg",
  France: "Flag of France.svg",
  Germany: "Flag of Germany.svg",
  Ghana: "Flag of Ghana.svg",
  Guatemala: "Flag of Guatemala.svg",
  Honduras: "Flag of Honduras.svg",
  Italy: "Flag of Italy.svg",
  Japan: "Flag of Japan.svg",
  Malaysia: "Flag of Malaysia.svg",
  Mexico: "Flag of Mexico.svg",
  Netherlands: "Flag of the Netherlands.svg",
  Panama: "Flag of Panama.svg",
  Paraguay: "Flag of Paraguay.svg",
  Peru: "Flag of Peru.svg",
  Poland: "Flag of Poland.svg",
  Portugal: "Flag of Portugal.svg",
  "Puerto Rico": "Flag of Puerto Rico.svg",
  Russia: "Flag of Russia.svg",
  Slovenia: "Flag of Slovenia.svg",
  Spain: "Flag of Spain.svg",
  Sweden: "Flag of Sweden.svg",
  Switzerland: "Flag of Switzerland.svg",
  Thailand: "Flag of Thailand.svg",
  Uganda: "Flag of Uganda.svg",
  "United Arab Emirates": "Flag of the United Arab Emirates.svg",
  "United States": "Flag of the United States.svg",
  Uruguay: "Flag of Uruguay.svg",
  Venezuela: "Flag of Venezuela.svg"
};

const autonomousCommunities: AutonomousCommunity[] = [
  {
    code: "andalucia",
    name: "Andalucía",
    flagUrl: wikimediaFlagUrl("Flag of Andalucía.svg"),
    keywords: ["andalucia", "andalusia", "andalusian", "almeria", "cadiz", "cordoba", "granada", "huelva", "jaen", "malaga", "marbella", "manilva", "estepona", "sevilla", "jerez", "algeciras"]
  },
  {
    code: "aragon",
    name: "Aragón",
    flagUrl: wikimediaFlagUrl("Flag of Aragón.svg"),
    keywords: ["aragon", "aragón", "huesca", "teruel", "zaragoza", "calatayud"]
  },
  {
    code: "asturias",
    name: "Asturias",
    flagUrl: wikimediaFlagUrl("Flag of Asturias.svg"),
    keywords: ["asturias", "principado de asturias", "principality of asturias", "oviedo", "gijon", "aviles", "langreo", "mieres"]
  },
  {
    code: "baleares",
    name: "Islas Baleares",
    flagUrl: wikimediaFlagUrl("Flag of the Balearic Islands.svg"),
    keywords: ["baleares", "illes balears", "islas baleares", "balearic islands", "mallorca", "majorca", "menorca", "minorca", "ibiza", "eivissa", "formentera", "palma"]
  },
  {
    code: "canarias",
    name: "Canarias",
    flagUrl: wikimediaFlagUrl("Flag of the Canary Islands.svg"),
    keywords: ["canarias", "islas canarias", "canary islands", "tenerife", "gran canaria", "lanzarote", "fuerteventura", "la palma", "la gomera", "el hierro", "las palmas", "la laguna", "santa cruz de tenerife"]
  },
  {
    code: "cantabria",
    name: "Cantabria",
    flagUrl: wikimediaFlagUrl("Flag of Cantabria.svg"),
    keywords: ["cantabria", "santander", "torrelavega", "castro urdiales"]
  },
  {
    code: "castilla-la-mancha",
    name: "Castilla-La Mancha",
    flagUrl: wikimediaFlagUrl("Flag of Castilla-La Mancha.svg"),
    keywords: ["castilla la mancha", "castilla-la mancha", "castile-la mancha", "castile la mancha", "albacete", "ciudad real", "cuenca", "guadalajara", "toledo", "talavera"]
  },
  {
    code: "castilla-y-leon",
    name: "Castilla y León",
    flagUrl: wikimediaFlagUrl("Flag of Castile and León.svg"),
    keywords: ["castilla y leon", "castilla leon", "castile and leon", "castile leon", "avila", "burgos", "leon", "palencia", "salamanca", "segovia", "soria", "valladolid", "zamora", "ponferrada"]
  },
  {
    code: "catalunya",
    name: "Cataluña",
    flagUrl: wikimediaFlagUrl("Flag of Catalonia.svg"),
    keywords: ["cataluna", "catalunya", "catalonia", "barcelona", "girona", "gerona", "lleida", "lerida", "tarragona", "badalona", "sabadell", "terrassa"]
  },
  {
    code: "comunitat-valenciana",
    name: "Comunidad Valenciana",
    flagUrl: wikimediaFlagUrl("Flag of the Valencian Community (2x3).svg"),
    keywords: ["comunidad valenciana", "comunitat valenciana", "valencian community", "alicante", "alacant", "castellon", "castello", "valencia", "valencia province", "elche", "elx"]
  },
  {
    code: "extremadura",
    name: "Extremadura",
    flagUrl: wikimediaFlagUrl("Flag of Extremadura.svg"),
    keywords: ["extremadura", "badajoz", "caceres", "merida", "plasencia"]
  },
  {
    code: "galicia",
    name: "Galicia",
    flagUrl: wikimediaFlagUrl("Flag of Galicia.svg"),
    keywords: ["galicia", "galiza", "galiza", "coruna", "a coruna", "lugo", "ourense", "orense", "pontevedra", "vigo", "santiago", "ferrol"]
  },
  {
    code: "madrid",
    name: "Comunidad de Madrid",
    flagUrl: wikimediaFlagUrl("Flag of the Community of Madrid.svg"),
    keywords: ["comunidad de madrid", "community of madrid", "madrid", "alcala de henares", "mostoles", "leganes", "getafe", "fuenlabrada", "alcorcon"]
  },
  {
    code: "murcia",
    name: "Región de Murcia",
    flagUrl: wikimediaFlagUrl("Flag of the Region of Murcia.svg"),
    keywords: ["region de murcia", "region of murcia", "murcia", "cartagena", "lorca", "molina de segura"]
  },
  {
    code: "navarra",
    name: "Navarra",
    flagUrl: wikimediaFlagUrl("Bandera de Navarra.svg"),
    keywords: ["navarra", "navarre", "nafarroa", "pamplona", "iruna", "tudela", "estella"]
  },
  {
    code: "euskadi",
    name: "País Vasco",
    flagUrl: wikimediaFlagUrl("Flag of the Basque Country.svg"),
    keywords: ["pais vasco", "euskadi", "basque country", "araba", "alava", "bizkaia", "vizcaya", "gipuzkoa", "guipuzcoa", "bilbao", "donostia", "san sebastian", "vitoria", "gasteiz", "barakaldo"]
  },
  {
    code: "la-rioja",
    name: "La Rioja",
    flagUrl: wikimediaFlagUrl("Flag of La Rioja (with coat of arms).svg"),
    keywords: ["la rioja", "rioja", "logrono", "calahorra", "arnedo", "haro"]
  },
  {
    code: "ceuta",
    name: "Ceuta",
    flagUrl: wikimediaFlagUrl("Flag of Ceuta.svg"),
    keywords: ["ceuta"]
  },
  {
    code: "melilla",
    name: "Melilla",
    flagUrl: wikimediaFlagUrl("Flag of Melilla.svg"),
    keywords: ["melilla"]
  }
];

const saintDaysByName: Record<string, { day: number; month: number }> = {
  adrian: { day: 8, month: 9 },
  agustin: { day: 28, month: 8 },
  alberto: { day: 15, month: 11 },
  alejandro: { day: 26, month: 2 },
  alejandra: { day: 20, month: 3 },
  alfonso: { day: 1, month: 8 },
  alicia: { day: 23, month: 6 },
  almudena: { day: 9, month: 11 },
  ana: { day: 26, month: 7 },
  andres: { day: 30, month: 11 },
  angel: { day: 2, month: 10 },
  angeles: { day: 2, month: 8 },
  antonio: { day: 13, month: 6 },
  antonia: { day: 17, month: 1 },
  beatriz: { day: 29, month: 7 },
  blanca: { day: 5, month: 8 },
  carlos: { day: 4, month: 11 },
  carmen: { day: 16, month: 7 },
  catalina: { day: 25, month: 11 },
  cristina: { day: 24, month: 7 },
  daniel: { day: 21, month: 7 },
  david: { day: 29, month: 12 },
  diego: { day: 13, month: 11 },
  domingo: { day: 8, month: 8 },
  eduardo: { day: 13, month: 10 },
  elena: { day: 18, month: 8 },
  elisa: { day: 5, month: 12 },
  emilio: { day: 22, month: 5 },
  enrique: { day: 13, month: 7 },
  esteban: { day: 26, month: 12 },
  esther: { day: 24, month: 5 },
  eugenia: { day: 25, month: 12 },
  felipe: { day: 3, month: 5 },
  fernando: { day: 30, month: 5 },
  francisco: { day: 4, month: 10 },
  gabriel: { day: 29, month: 9 },
  gloria: { day: 26, month: 7 },
  gonzalo: { day: 10, month: 1 },
  gregoria: { day: 9, month: 5 },
  gregorio: { day: 9, month: 5 },
  guillermo: { day: 10, month: 2 },
  ines: { day: 21, month: 1 },
  irene: { day: 5, month: 4 },
  isabel: { day: 5, month: 11 },
  javier: { day: 3, month: 12 },
  jesus: { day: 3, month: 1 },
  joaquin: { day: 26, month: 7 },
  jorge: { day: 23, month: 4 },
  jose: { day: 19, month: 3 },
  josefa: { day: 19, month: 3 },
  juan: { day: 24, month: 6 },
  juana: { day: 24, month: 6 },
  julia: { day: 8, month: 4 },
  julio: { day: 12, month: 4 },
  laura: { day: 19, month: 10 },
  lucia: { day: 13, month: 12 },
  luis: { day: 21, month: 6 },
  luisa: { day: 15, month: 3 },
  manuel: { day: 1, month: 1 },
  manuela: { day: 1, month: 1 },
  marcelo: { day: 16, month: 1 },
  marcos: { day: 25, month: 4 },
  margarita: { day: 16, month: 11 },
  maria: { day: 12, month: 9 },
  mariano: { day: 19, month: 8 },
  marina: { day: 18, month: 7 },
  mario: { day: 19, month: 1 },
  marta: { day: 29, month: 7 },
  martin: { day: 11, month: 11 },
  mateo: { day: 21, month: 9 },
  mercedes: { day: 24, month: 9 },
  miguel: { day: 29, month: 9 },
  monica: { day: 27, month: 8 },
  natalia: { day: 27, month: 7 },
  nicolas: { day: 6, month: 12 },
  pablo: { day: 29, month: 6 },
  patricio: { day: 17, month: 3 },
  pedro: { day: 29, month: 6 },
  pilar: { day: 12, month: 10 },
  rafael: { day: 29, month: 9 },
  ramon: { day: 31, month: 8 },
  raul: { day: 30, month: 12 },
  rocio: { day: 8, month: 9 },
  rosa: { day: 23, month: 8 },
  rosario: { day: 7, month: 10 },
  ruben: { day: 4, month: 8 },
  salvador: { day: 6, month: 8 },
  santiago: { day: 25, month: 7 },
  sara: { day: 20, month: 4 },
  sergio: { day: 8, month: 9 },
  sofia: { day: 18, month: 9 },
  teresa: { day: 15, month: 10 },
  tomas: { day: 3, month: 7 },
  valentin: { day: 14, month: 2 },
  veronica: { day: 9, month: 7 },
  vicente: { day: 22, month: 1 },
  victoria: { day: 23, month: 12 }
};

const countryCoordinates: Record<string, { label: string; lat: number; lon: number }> = {
  espana: { label: "España", lat: 40.42, lon: -3.7 },
  spain: { label: "Spain", lat: 40.42, lon: -3.7 },
  portugal: { label: "Portugal", lat: 38.72, lon: -9.14 },
  francia: { label: "Francia", lat: 48.86, lon: 2.35 },
  france: { label: "France", lat: 48.86, lon: 2.35 },
  italia: { label: "Italia", lat: 41.9, lon: 12.5 },
  italy: { label: "Italy", lat: 41.9, lon: 12.5 },
  alemania: { label: "Alemania", lat: 52.52, lon: 13.4 },
  germany: { label: "Germany", lat: 52.52, lon: 13.4 },
  "reino unido": { label: "Reino Unido", lat: 51.5, lon: -0.12 },
  "united kingdom": { label: "United Kingdom", lat: 51.5, lon: -0.12 },
  mexico: { label: "México", lat: 19.43, lon: -99.13 },
  "estados unidos": { label: "Estados Unidos", lat: 38.9, lon: -77.04 },
  usa: { label: "USA", lat: 38.9, lon: -77.04 },
  "united states": { label: "United States", lat: 38.9, lon: -77.04 },
  argentina: { label: "Argentina", lat: -34.6, lon: -58.38 },
  chile: { label: "Chile", lat: -33.45, lon: -70.66 },
  colombia: { label: "Colombia", lat: 4.71, lon: -74.07 },
  peru: { label: "Perú", lat: -12.05, lon: -77.04 },
  uruguay: { label: "Uruguay", lat: -34.9, lon: -56.16 },
  venezuela: { label: "Venezuela", lat: 10.48, lon: -66.9 },
  brasil: { label: "Brasil", lat: -15.79, lon: -47.88 },
  brazil: { label: "Brazil", lat: -15.79, lon: -47.88 },
  cuba: { label: "Cuba", lat: 23.11, lon: -82.37 },
  marruecos: { label: "Marruecos", lat: 34.02, lon: -6.83 },
  morocco: { label: "Morocco", lat: 34.02, lon: -6.83 }
};

const cityCoordinates: Record<string, { label: string; lat: number; lon: number }> = {
  madrid: { label: "Madrid", lat: 40.42, lon: -3.7 },
  barcelona: { label: "Barcelona", lat: 41.39, lon: 2.17 },
  valencia: { label: "Valencia", lat: 39.47, lon: -0.38 },
  sevilla: { label: "Sevilla", lat: 37.39, lon: -5.99 },
  zaragoza: { label: "Zaragoza", lat: 41.65, lon: -0.89 },
  malaga: { label: "Málaga", lat: 36.72, lon: -4.42 },
  murcia: { label: "Murcia", lat: 37.98, lon: -1.13 },
  palma: { label: "Palma", lat: 39.57, lon: 2.65 },
  "las palmas": { label: "Las Palmas", lat: 28.12, lon: -15.43 },
  bilbao: { label: "Bilbao", lat: 43.26, lon: -2.93 },
  alicante: { label: "Alicante", lat: 38.35, lon: -0.48 },
  cordoba: { label: "Córdoba", lat: 37.89, lon: -4.78 },
  valladolid: { label: "Valladolid", lat: 41.65, lon: -4.72 },
  vigo: { label: "Vigo", lat: 42.24, lon: -8.72 },
  gijon: { label: "Gijón", lat: 43.53, lon: -5.66 },
  hospitalet: { label: "Hospitalet", lat: 41.36, lon: 2.1 },
  coruna: { label: "A Coruña", lat: 43.36, lon: -8.41 },
  "a coruna": { label: "A Coruña", lat: 43.36, lon: -8.41 },
  granada: { label: "Granada", lat: 37.18, lon: -3.6 },
  oviedo: { label: "Oviedo", lat: 43.36, lon: -5.85 },
  pamplona: { label: "Pamplona", lat: 42.82, lon: -1.64 },
  santander: { label: "Santander", lat: 43.46, lon: -3.81 },
  burgos: { label: "Burgos", lat: 42.34, lon: -3.7 },
  salamanca: { label: "Salamanca", lat: 40.97, lon: -5.66 },
  cadiz: { label: "Cádiz", lat: 36.53, lon: -6.29 },
  huelva: { label: "Huelva", lat: 37.26, lon: -6.94 },
  jaen: { label: "Jaén", lat: 37.78, lon: -3.79 },
  almeria: { label: "Almería", lat: 36.84, lon: -2.46 },
  leon: { label: "León", lat: 42.6, lon: -5.57 },
  logrono: { label: "Logroño", lat: 42.46, lon: -2.45 },
  toledo: { label: "Toledo", lat: 39.86, lon: -4.03 },
  caceres: { label: "Cáceres", lat: 39.47, lon: -6.37 },
  badajoz: { label: "Badajoz", lat: 38.88, lon: -6.97 },
  lisboa: { label: "Lisboa", lat: 38.72, lon: -9.14 },
  paris: { label: "París", lat: 48.86, lon: 2.35 },
  london: { label: "London", lat: 51.5, lon: -0.12 },
  londres: { label: "Londres", lat: 51.5, lon: -0.12 },
  roma: { label: "Roma", lat: 41.9, lon: 12.5 },
  berlin: { label: "Berlín", lat: 52.52, lon: 13.4 },
  "ciudad de mexico": { label: "Ciudad de México", lat: 19.43, lon: -99.13 },
  buenosaires: { label: "Buenos Aires", lat: -34.6, lon: -58.38 },
  "buenos aires": { label: "Buenos Aires", lat: -34.6, lon: -58.38 }
};

const cityCountryCoordinates: Record<string, { label: string; lat: number; lon: number }> = {
  "cordoba,argentina": { label: "Córdoba, Argentina", lat: -31.42, lon: -64.18 },
  "valencia,venezuela": { label: "Valencia, Venezuela", lat: 10.16, lon: -68.01 }
};

function contributionFields(t: Record<string, string>) {
  return [
    { key: "givenName", label: t.givenName },
    { key: "familyName", label: t.familyName },
    { key: "gender", label: t.gender },
    { key: "birthDate", label: t.birthDate },
    { key: "birthCity", label: t.birthCity },
    { key: "birthCountry", label: t.birthCountry },
    { key: "isDeceased", label: t.isDeceased },
    { key: "deathDate", label: t.deathDate },
    { key: "notes", label: t.notes }
  ] as const;
}

function normalizeContribution(raw: Partial<ContributionRecord>): ContributionRecord {
  if (raw.format !== "opentree-contribution-response" || !raw.requestId || !raw.targetPersonId || !raw.personPatch) {
    throw new Error("Invalid contribution");
  }

  return {
    id: raw.id || createId("contribution"),
    format: "opentree-contribution-response",
    version: Number(raw.version) || 1,
    requestId: String(raw.requestId),
    targetPersonId: String(raw.targetPersonId),
    submittedAt: raw.submittedAt || new Date().toISOString(),
    importedAt: new Date().toISOString(),
    status: "pending",
    contributorName: raw.contributorName ? String(raw.contributorName) : undefined,
    contributorEmail: raw.contributorEmail ? String(raw.contributorEmail) : undefined,
    comment: raw.comment ? String(raw.comment) : undefined,
    source: sanitizeContributionSource(raw.source),
    personPatch: sanitizeContributionPersonPatch(raw.personPatch),
    relatedPatches: Array.isArray(raw.relatedPatches)
      ? raw.relatedPatches
          .filter((patch) => patch?.targetPersonId && patch?.personPatch)
          .map((patch) => ({
            targetPersonId: String(patch.targetPersonId),
            relationshipLabel: String(patch.relationshipLabel || ""),
            personPatch: sanitizeContributionPersonPatch(patch.personPatch)
          }))
      : []
  };
}

function sanitizeContributionSource(source: ContributionRecord["source"]) {
  if (!source) return undefined;
  const sourceType = ["manual", "external"].includes(String(source.type)) ? source.type : "external";

  return {
    type: sourceType,
    title: source.title ? String(source.title) : undefined,
    url: source.url ? String(source.url) : undefined,
    archive: source.archive ? String(source.archive) : undefined,
    signature: source.signature ? String(source.signature) : undefined,
    date: source.date ? String(source.date) : undefined,
    notes: source.notes ? String(source.notes) : undefined
  };
}

function sanitizeContributionPersonPatch(patch: ContributionRecord["personPatch"] = {}) {
  const nextPatch: ContributionRecord["personPatch"] = {};
  const stringFields = [
    "givenName",
    "familyName",
    "birthDate",
    "birthCity",
    "birthCountry",
    "birthPlace",
    "deathDate",
    "notes"
  ] as const;

  stringFields.forEach((field) => {
    if (patch[field] !== undefined) {
      nextPatch[field] = String(patch[field]);
    }
  });

  if (["female", "male", "non_binary", "unknown"].includes(String(patch.gender))) {
    nextPatch.gender = patch.gender;
  }

  if (patch.isDeceased !== undefined) {
    nextPatch.isDeceased = Boolean(patch.isDeceased);
  }

  return nextPatch;
}

function applyContributionPatch(person: Person, patch: ContributionRecord["personPatch"]) {
  const nextPatch = sanitizeContributionPersonPatch(patch);
  const nextPerson = { ...person, ...nextPatch };

  nextPerson.birthPlace = joinPlace(nextPerson.birthCity ?? "", nextPerson.birthCountry ?? "");

  if (nextPatch.isDeceased === false) {
    nextPerson.deathDate = "";
    nextPerson.deathCity = "";
    nextPerson.deathCountry = "";
    nextPerson.deathPlace = "";
  }

  return nextPerson;
}

function getContributionPatchFor(contribution: ContributionRecord, targetPersonId: string) {
  if (contribution.targetPersonId === targetPersonId) return contribution.personPatch;
  return contribution.relatedPatches?.find((patch) => patch.targetPersonId === targetPersonId)?.personPatch;
}

function removeContributionField(
  contribution: ContributionRecord,
  targetPersonId: string,
  field: keyof ContributionRecord["personPatch"]
): ContributionRecord {
  if (contribution.targetPersonId === targetPersonId) {
    const nextPatch = { ...contribution.personPatch };
    delete nextPatch[field];
    return { ...contribution, personPatch: nextPatch };
  }

  return {
    ...contribution,
    relatedPatches: contribution.relatedPatches?.map((relatedPatch) => {
      if (relatedPatch.targetPersonId !== targetPersonId) return relatedPatch;
      const nextPatch = { ...relatedPatch.personPatch };
      delete nextPatch[field];
      return { ...relatedPatch, personPatch: nextPatch };
    })
  };
}

function buildContributionRequestHtml({
  requestId,
  projectName,
  person,
  relatedPeople,
  locale,
  personalMessage,
  logoDataUrl
}: {
  requestId: string;
  projectName: string;
  person: Person;
  relatedPeople: Array<{ relationshipLabel: string; person: Person }>;
  locale: Locale;
  personalMessage: string;
  logoDataUrl: string;
}) {
  const labels =
    locale === "es"
      ? {
          title: "Revisar datos familiares",
          contributorName: "Tu nombre",
          contributorEmail: "Tu email",
          generate: "Generar archivo para enviar",
          generated: "Archivo generado. Adjunta el .json a tu respuesta de correo.",
          gender: "Sexo",
          unknown: "Sin especificar",
          female: "Mujer",
          male: "Hombre",
          nonBinary: "No binario",
          givenName: "Nombre",
          familyName: "Apellidos",
          birthDate: "Fecha de nacimiento",
          birthCity: "Ciudad de nacimiento",
          birthCountry: "País de nacimiento"
        }
      : {
          title: "Review family details",
          contributorName: "Your name",
          contributorEmail: "Your email",
          generate: "Generate file to send",
          generated: "File generated. Attach the .json to your email reply.",
          gender: "Sex",
          unknown: "Unspecified",
          female: "Female",
          male: "Male",
          nonBinary: "Non-binary",
          givenName: "Given name",
          familyName: "Family name",
          birthDate: "Date of birth",
          birthCity: "Birth city",
          birthCountry: "Birth country"
        };
  const request = {
    requestId,
    projectName,
    targetPersonId: person.id,
    person: {
      givenName: person.givenName,
      familyName: person.familyName,
      gender: person.gender,
      birthDate: person.birthDate ?? "",
      birthCity: person.birthCity ?? splitPlace(person.birthPlace).city,
      birthCountry: person.birthCountry ?? splitPlace(person.birthPlace).country
    },
    relatedPeople: relatedPeople.map((entry) => ({
      relationshipLabel: entry.relationshipLabel,
      targetPersonId: entry.person.id,
      person: contributionPersonSnapshot(entry.person)
    }))
  };
  const embeddedRequest = JSON.stringify(request).replace(/</g, "\\u003c");
  const embeddedLabels = JSON.stringify(labels).replace(/</g, "\\u003c");
  const relatedSections = relatedPeople
    .map(
      (entry, index) => `
      <section class="relative-section" data-related-index="${index}">
        <h2>${escapeHtml(entry.relationshipLabel)}: ${escapeHtml(fullName(entry.person) || labels.givenName)}</h2>
        ${buildContributionPersonFields(labels, `related-${index}`)}
      </section>`
    )
    .join("");

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenTree - ${escapeHtml(labels.title)}</title>
  <style>
    :root { color: #25312e; background: #f4faf8; font-family: Inter, Segoe UI, Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    main { width: min(840px, calc(100% - 28px)); margin: 28px auto; display: grid; gap: 20px; }
    header, form { background: rgba(255,255,255,.95); border: 1px solid rgba(7,95,88,.16); border-radius: 8px; padding: 22px; box-shadow: 0 18px 55px rgba(7,95,88,.1); }
    header { position: relative; min-height: 132px; padding-right: 158px; }
    .logo { position: absolute; top: 18px; right: 20px; width: 110px; height: auto; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1; }
    p { margin: 0; color: #60706c; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 6px; color: #53615b; font-size: .82rem; font-weight: 800; }
    input, select, textarea { width: 100%; min-height: 44px; border: 1px solid rgba(7,95,88,.16); border-radius: 8px; padding: 0 12px; color: #25312e; background: #fbfdfc; font: inherit; }
    textarea { min-height: 100px; padding: 10px 12px; resize: vertical; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .relative-section { display: grid; gap: 12px; padding: 16px; border: 1px solid rgba(7,95,88,.16); border-radius: 8px; background: #fbfdfc; }
    .relative-section h2 { margin: 0; color: #075f58; font-size: 1rem; }
    .check { display: flex; align-items: center; gap: 10px; min-height: 42px; }
    .check input { width: 18px; min-height: 18px; accent-color: #087d72; }
    button { min-height: 46px; border: 0; border-radius: 8px; padding: 0 16px; color: #fff8ed; background: #087d72; font-weight: 800; cursor: pointer; }
    #status { min-height: 24px; color: #075f58; font-weight: 800; }
    @media (max-width: 680px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <img class="logo" src="${logoDataUrl}" alt="OpenTree" />
      <h1>${escapeHtml(projectName)}</h1>
      <p>${escapeHtml(personalMessage)}</p>
    </header>
    <form id="form">
      <div class="grid">
        <label>${escapeHtml(labels.contributorName)}<input name="contributorName" /></label>
        <label>${escapeHtml(labels.contributorEmail)}<input name="contributorEmail" type="email" /></label>
      </div>
      <div class="grid">
        <label>${escapeHtml(labels.givenName)}<input name="givenName" /></label>
        <label>${escapeHtml(labels.familyName)}<input name="familyName" /></label>
      </div>
      <label>${escapeHtml(labels.gender)}
        <select name="gender">
          <option value="unknown">${escapeHtml(labels.unknown)}</option>
          <option value="female">${escapeHtml(labels.female)}</option>
          <option value="male">${escapeHtml(labels.male)}</option>
          <option value="non_binary">${escapeHtml(labels.nonBinary)}</option>
        </select>
      </label>
      <div class="grid">
        <label>${escapeHtml(labels.birthDate)}<input name="birthDate" /></label>
        <label>${escapeHtml(labels.birthCity)}<input name="birthCity" /></label>
      </div>
      <label>${escapeHtml(labels.birthCountry)}<input name="birthCountry" /></label>
      ${relatedSections}
      <button type="submit">${escapeHtml(labels.generate)}</button>
      <p id="status"></p>
    </form>
  </main>
  <script>
    const request = ${embeddedRequest};
    const labels = ${embeddedLabels};
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    function fillPerson(prefix, person) {
      Object.entries(person).forEach(([key, value]) => {
        const field = form.elements[prefix ? prefix + "." + key : key];
        if (!field) return;
        field.value = value || "";
      });
    }
    function readPerson(prefix, data) {
      const name = (key) => prefix ? prefix + "." + key : key;
      return {
        givenName: String(data.get(name("givenName")) || ""),
        familyName: String(data.get(name("familyName")) || ""),
        gender: String(data.get(name("gender")) || "unknown"),
        birthDate: String(data.get(name("birthDate")) || ""),
        birthCity: String(data.get(name("birthCity")) || ""),
        birthCountry: String(data.get(name("birthCountry")) || ""),
        isDeceased: false
      };
    }
    fillPerson("", request.person);
    request.relatedPeople.forEach((entry, index) => fillPerson("related-" + index, entry.person));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const relatedPatches = request.relatedPeople.map((entry, index) => ({
        targetPersonId: entry.targetPersonId,
        relationshipLabel: entry.relationshipLabel,
        personPatch: readPerson("related-" + index, data)
      }));
      const response = {
        format: "opentree-contribution-response",
        version: 1,
        requestId: request.requestId,
        targetPersonId: request.targetPersonId,
        submittedAt: new Date().toISOString(),
        contributorName: String(data.get("contributorName") || ""),
        contributorEmail: String(data.get("contributorEmail") || ""),
        personPatch: readPerson("", data),
        relatedPatches
      };
      const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "opentree-aporte-" + request.requestId + ".json";
      anchor.click();
      URL.revokeObjectURL(url);
      status.textContent = labels.generated;
    });
  </script>
</body>
</html>`;
}

function contributionPersonSnapshot(person: Person) {
  return {
    givenName: person.givenName,
    familyName: person.familyName,
    gender: person.gender,
    birthDate: person.birthDate ?? "",
    birthCity: person.birthCity ?? splitPlace(person.birthPlace).city,
    birthCountry: person.birthCountry ?? splitPlace(person.birthPlace).country
  };
}

function buildContributionPersonFields(labels: Record<string, string>, prefix: string) {
  const name = (field: string) => `${prefix}.${field}`;

  return `
      <div class="grid">
        <label>${escapeHtml(labels.givenName)}<input name="${name("givenName")}" /></label>
        <label>${escapeHtml(labels.familyName)}<input name="${name("familyName")}" /></label>
      </div>
      <label>${escapeHtml(labels.gender)}
        <select name="${name("gender")}">
          <option value="unknown">${escapeHtml(labels.unknown)}</option>
          <option value="female">${escapeHtml(labels.female)}</option>
          <option value="male">${escapeHtml(labels.male)}</option>
          <option value="non_binary">${escapeHtml(labels.nonBinary)}</option>
        </select>
      </label>
      <div class="grid">
        <label>${escapeHtml(labels.birthDate)}<input name="${name("birthDate")}" /></label>
        <label>${escapeHtml(labels.birthCity)}<input name="${name("birthCity")}" /></label>
      </div>
      <label>${escapeHtml(labels.birthCountry)}<input name="${name("birthCountry")}" /></label>`;
}

async function loadLogoDataUrl() {
  try {
    const response = await fetch("/opentree-logo.png");
    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

function downloadTextFile(fileName: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}
