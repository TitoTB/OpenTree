import type { TreeProject } from "../domain/types";

const STORAGE_KEY = "opentree.project.v1";

export type ServerRole = "admin" | "guest";

export interface PendingProjectChange {
  id: string;
  status: "pending";
  role: "guest";
  sessionToken?: string;
  kind?: "add_person" | "edit_person" | "add_relationship" | "edit_relationship" | "add_photo" | "edit_photo" | "project_snapshot";
  entityType?: "person" | "relationship" | "photo" | "project";
  entityId?: string;
  title?: string;
  details?: string[];
  summary: {
    addedPeople: number;
    editedPeople: number;
    addedPhotos: number;
    relationshipDelta: number;
  };
  proposedProject: TreeProject;
  createdAt: string;
  updatedAt?: string;
}

export interface ServerSettings {
  guestPhotoLimit: number;
}

export interface BootstrapState {
  serverMode: boolean;
  authenticated: boolean;
  role: ServerRole | null;
  project: TreeProject | null;
  settings: ServerSettings;
  pendingProjectChanges: PendingProjectChange[];
}

type ProjectSyncDetail = {
  project: TreeProject | null;
  pendingProjectChanges?: PendingProjectChange[];
  status?: "saved" | "pending";
  error?: string;
};

let serverMode = false;
let serverRole: ServerRole | null = null;

export function loadProject(): TreeProject | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return null;
  }

  try {
    const project = stripPersonDocuments(JSON.parse(stored) as TreeProject);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return project;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function bootstrapProjectStore(): Promise<BootstrapState> {
  try {
    const response = await fetch("/api/bootstrap", { credentials: "include" });
    if (!response.ok) throw new Error("No OpenTree server API");
    const data = (await response.json()) as Omit<BootstrapState, "serverMode">;
    serverMode = true;
    serverRole = data.role;
    const project = data.project ? stripPersonDocuments(data.project) : null;
    if (project) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
    return {
      serverMode: true,
      authenticated: data.authenticated,
      role: data.role,
      project,
      settings: normalizeServerSettings(data.settings),
      pendingProjectChanges: data.pendingProjectChanges ?? []
    };
  } catch {
    serverMode = false;
    serverRole = null;
    return {
      serverMode: false,
      authenticated: true,
      role: "admin",
      project: loadProject(),
      settings: { guestPhotoLimit: 50 },
      pendingProjectChanges: []
    };
  }
}

export async function loginToServer(role: ServerRole, password: string): Promise<BootstrapState> {
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, password })
  });
  if (!response.ok) throw new Error("INVALID_CREDENTIALS");
  const data = (await response.json()) as Omit<BootstrapState, "serverMode">;
  serverMode = true;
  serverRole = data.role;
  const project = data.project ? stripPersonDocuments(data.project) : null;
  if (project) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }
  return {
    serverMode: true,
    authenticated: data.authenticated,
    role: data.role,
    project,
    settings: normalizeServerSettings(data.settings),
    pendingProjectChanges: data.pendingProjectChanges ?? []
  };
}

export async function logoutFromServer() {
  if (!serverMode) return;
  await fetch("/api/logout", { method: "POST", credentials: "include" });
  serverRole = null;
}

export function saveProject(project: TreeProject) {
  const projectWithoutDocuments = stripPersonDocuments(project);

  if (serverMode) {
    void saveProjectToServer(projectWithoutDocuments);
    return true;
  }

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...projectWithoutDocuments, updatedAt: new Date().toISOString() })
    );
    return true;
  } catch (error) {
    console.error("OpenTree could not save the project.", error);
    window.alert(
      "No se ha podido guardar el proyecto. Es posible que el almacenamiento local esté lleno; prueba a importar fotos más ligeras o elimina algunas imágenes."
    );
    return false;
  }
}

export function clearProject() {
  if (!serverMode) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export async function acceptPendingProjectChange(id: string) {
  return postPendingProjectChange(id, "accept");
}

export async function rejectPendingProjectChange(id: string) {
  return postPendingProjectChange(id, "reject");
}

export async function updateServerSettings(settings: Partial<ServerSettings>) {
  const response = await fetch("/api/settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings })
  });
  if (!response.ok) throw new Error("SETTINGS_ERROR");
  const data = (await response.json()) as { settings: ServerSettings };
  return normalizeServerSettings(data.settings);
}

export async function updateServerPasswords(passwords: Partial<Record<ServerRole, string>>) {
  const response = await fetch("/api/passwords", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passwords })
  });
  if (!response.ok) throw new Error("PASSWORD_ERROR");
}

export function addProjectSyncListener(listener: (detail: ProjectSyncDetail) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<ProjectSyncDetail>).detail);
  window.addEventListener("opentree:project-sync", handler);
  return () => window.removeEventListener("opentree:project-sync", handler);
}

async function saveProjectToServer(project: TreeProject) {
  try {
    const projectWithoutDocuments = stripPersonDocuments(project);
    const response = await fetch("/api/project", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectWithoutDocuments })
    });
    const data = (await response.json()) as ProjectSyncDetail;
    if (!response.ok) throw new Error(data.error || "SAVE_ERROR");
    const savedProject = data.project ? stripPersonDocuments(data.project) : null;
    if (savedProject) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProject));
    }
    window.dispatchEvent(
      new CustomEvent<ProjectSyncDetail>("opentree:project-sync", {
        detail: {
          project: savedProject,
          pendingProjectChanges: data.pendingProjectChanges,
          status: data.status || (serverRole === "guest" ? "pending" : "saved")
        }
      })
    );
  } catch (error) {
    console.error("OpenTree server save failed.", error);
    window.dispatchEvent(
      new CustomEvent<ProjectSyncDetail>("opentree:project-sync", {
        detail: { project: null, error: error instanceof Error ? error.message : "SAVE_ERROR" }
      })
    );
  }
}

async function postPendingProjectChange(id: string, action: "accept" | "reject") {
  const response = await fetch(`/api/pending-project-changes/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    credentials: "include"
  });
  if (!response.ok) throw new Error("PENDING_CHANGE_ERROR");
  const data = (await response.json()) as { project: TreeProject | null; pendingProjectChanges: PendingProjectChange[] };
  const project = data.project ? stripPersonDocuments(data.project) : null;
  if (project) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  }
  return { ...data, project };
}

function normalizeServerSettings(settings?: Partial<ServerSettings>): ServerSettings {
  return {
    guestPhotoLimit: Math.max(0, Number(settings?.guestPhotoLimit ?? 50))
  };
}

function stripPersonDocuments(project: TreeProject): TreeProject {
  return {
    ...project,
    people: (project.people ?? []).map((person) => {
      const { documents: _documents, ...personWithoutDocuments } = person as typeof person & { documents?: unknown };
      return personWithoutDocuments;
    })
  };
}
