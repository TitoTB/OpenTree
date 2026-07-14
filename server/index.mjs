import { createServer } from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const distDir = resolve(rootDir, "dist");
const dataDir = process.env.OPENTREE_DATA_DIR || (process.platform === "win32" ? join(rootDir, ".opentree-data") : "/data");
const port = Number(process.env.PORT || process.env.OPENTREE_PORT || 8080);

const configPath = join(dataDir, "config.json");
const projectPath = join(dataDir, "project.json");
const pendingPath = join(dataDir, "pending-project-changes.json");
const sessions = new Map();

const externalSourceProxies = [
  {
    prefix: "/ine-api",
    origin: "https://www.ine.es",
    accept: "application/json,text/plain,*/*",
    allowedPath: (path) => path.startsWith("/apellidos/")
  },
  {
    prefix: "/forebears-api",
    origin: "https://forebears.io",
    accept: "text/html,application/xhtml+xml",
    fallbackToReader: true
  },
  {
    prefix: "/geneanet-api",
    origin: "https://es.geneanet.org",
    accept: "text/html,application/xhtml+xml",
    allowedPath: (path) => path.startsWith("/apellidos/"),
    fallbackToReader: true
  },
  {
    prefix: "/behindthename-api",
    origin: "https://www.behindthename.com",
    accept: "text/html,application/xhtml+xml",
    allowedPath: (path) => path.startsWith("/name/")
  },
  {
    prefix: "/translate-api",
    origin: "https://api.mymemory.translated.net",
    accept: "application/json,text/plain,*/*"
  },
  {
    prefix: "/medlineplus-api",
    origin: "https://wsearch.nlm.nih.gov",
    accept: "application/json,text/xml,text/plain,*/*"
  },
  {
    prefix: "/mayo-clinic-api",
    origin: "https://www.mayoclinic.org",
    accept: "text/html,application/xhtml+xml"
  }
];

const defaultProjectSettings = {
  guestPhotoLimit: 50
};

function ensureDataDir() {
  mkdirSync(dataDir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${randomBytes(9).toString("hex")}`;
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Could not read ${path}`, error);
    return fallback;
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadConfig() {
  ensureDataDir();
  const existing = readJson(configPath, null);
  if (existing?.users?.admin?.passwordHash && existing?.users?.guest?.passwordHash) {
    return {
      ...existing,
      settings: { ...defaultProjectSettings, ...(existing.settings || {}) }
    };
  }

  const adminPassword = process.env.OPENTREE_ADMIN_PASSWORD || "OpenTreeAdmin2026!";
  const guestPassword = process.env.OPENTREE_GUEST_PASSWORD || "OpenTreeInvitado2026!";
  const initial = {
    users: {
      admin: { passwordHash: hashPassword(adminPassword), updatedAt: now() },
      guest: { passwordHash: hashPassword(guestPassword), updatedAt: now() }
    },
    settings: defaultProjectSettings,
    createdAt: now(),
    updatedAt: now()
  };
  writeJson(configPath, initial);
  console.warn(
    "OpenTree initial passwords created. Change them in Ajustes. Defaults: admin=OpenTreeAdmin2026!, invitado=OpenTreeInvitado2026!"
  );
  return initial;
}

let config = loadConfig();

function loadProject() {
  return readJson(projectPath, null);
}

function saveProject(project) {
  const nextProject = {
    ...project,
    updatedAt: now()
  };
  writeJson(projectPath, nextProject);
  return nextProject;
}

function loadPendingChanges() {
  return readJson(pendingPath, []);
}

function savePendingChanges(changes) {
  writeJson(pendingPath, changes);
}

function sanitizeGuestProject(proposedProject, currentProject) {
  if (!currentProject) return proposedProject;
  const proposedPeople = mergeById(currentProject.people || [], proposedProject.people || []);
  const proposedRelationships = mergeById(currentProject.relationships || [], proposedProject.relationships || []);
  const proposedPhotos = mergeById(currentProject.galleryPhotos || [], proposedProject.galleryPhotos || []);

  return {
    ...proposedProject,
    id: currentProject.id,
    name: currentProject.name,
    locale: currentProject.locale,
    people: proposedPeople,
    relationships: proposedRelationships,
    galleryPhotos: proposedPhotos,
    displaySettings: currentProject.displaySettings,
    surnameProfiles: currentProject.surnameProfiles,
    nameProfiles: currentProject.nameProfiles,
    clinicalConditions: currentProject.clinicalConditions,
    clinicalConditionCategories: currentProject.clinicalConditionCategories,
    worldHistoryEvents: currentProject.worldHistoryEvents,
    famousBirths: currentProject.famousBirths,
    contributions: currentProject.contributions,
    createdAt: currentProject.createdAt,
    updatedAt: now()
  };
}

function mergeById(currentItems, proposedItems) {
  const merged = new Map();
  currentItems.forEach((item) => merged.set(item.id, item));
  proposedItems.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function countPhotos(project) {
  return Array.isArray(project?.galleryPhotos) ? project.galleryPhotos.length : 0;
}

function summarizeProjectChange(currentProject, proposedProject) {
  const currentPeople = new Map((currentProject?.people || []).map((person) => [person.id, person]));
  const proposedPeople = new Map((proposedProject?.people || []).map((person) => [person.id, person]));
  const addedPeople = [...proposedPeople.keys()].filter((id) => !currentPeople.has(id)).length;
  const editedPeople = [...proposedPeople.entries()].filter(([id, person]) => {
    const current = currentPeople.get(id);
    return current && JSON.stringify(current) !== JSON.stringify(person);
  }).length;
  const addedPhotos = Math.max(0, countPhotos(proposedProject) - countPhotos(currentProject));
  const relationshipDelta = Math.max(
    0,
    (proposedProject?.relationships?.length || 0) - (currentProject?.relationships?.length || 0)
  );
  return { addedPeople, editedPeople, addedPhotos, relationshipDelta };
}

function getSession(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies.opentree_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  session.lastSeenAt = Date.now();
  return { token, ...session };
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function bootstrapPayload(session) {
  const role = session?.role || null;
  const pendingChanges = role === "admin" ? loadPendingChanges() : [];
  const guestPendingChange =
    role === "guest" && session?.token
      ? loadPendingChanges().find((change) => change.role === "guest" && change.sessionToken === session.token)
      : null;
  return {
    authenticated: Boolean(role),
    role,
    project: role ? guestPendingChange?.proposedProject || loadProject() : null,
    settings: config.settings,
    pendingProjectChanges: pendingChanges
  };
}

async function handleApi(request, response, pathname) {
  const session = getSession(request);

  if (request.method === "GET" && pathname === "/api/bootstrap") {
    return sendJson(response, 200, bootstrapPayload(session));
  }

  if (request.method === "POST" && pathname === "/api/login") {
    const body = await readBody(request);
    const role = body.role === "guest" ? "guest" : "admin";
    const user = config.users?.[role];
    if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
      return sendJson(response, 401, { error: "INVALID_CREDENTIALS" });
    }

    const token = randomBytes(32).toString("hex");
    sessions.set(token, { role, createdAt: Date.now(), lastSeenAt: Date.now() });
    return sendJson(response, 200, bootstrapPayload({ role }), {
      "Set-Cookie": `opentree_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`
    });
  }

  if (request.method === "POST" && pathname === "/api/logout") {
    if (session?.token) sessions.delete(session.token);
    return sendJson(response, 200, { ok: true }, { "Set-Cookie": "opentree_session=; Max-Age=0; Path=/" });
  }

  if (!session) {
    return sendJson(response, 401, { error: "AUTH_REQUIRED" });
  }

  if (request.method === "PUT" && pathname === "/api/project") {
    const body = await readBody(request);
    const proposedProject = body.project;
    if (!proposedProject || !Array.isArray(proposedProject.people) || !Array.isArray(proposedProject.relationships)) {
      return sendJson(response, 400, { error: "INVALID_PROJECT" });
    }

    if (session.role === "admin") {
      const savedProject = saveProject(proposedProject);
      return sendJson(response, 200, { status: "saved", project: savedProject, pendingProjectChanges: loadPendingChanges() });
    }

    const currentProject = loadProject();
    const sanitizedProject = sanitizeGuestProject(proposedProject, currentProject);
    const addedPhotos = Math.max(0, countPhotos(sanitizedProject) - countPhotos(currentProject));
    if (addedPhotos > Number(config.settings.guestPhotoLimit || 0)) {
      return sendJson(response, 413, { error: "GUEST_PHOTO_LIMIT_EXCEEDED", project: currentProject });
    }

    const pendingChanges = loadPendingChanges();
    const existingGuestChange = pendingChanges.find(
      (candidate) => candidate.role === "guest" && candidate.sessionToken === session.token
    );
    const nextChange = {
      id: existingGuestChange?.id || createId("guest-change"),
      status: "pending",
      role: "guest",
      sessionToken: session.token,
      summary: summarizeProjectChange(currentProject, sanitizedProject),
      proposedProject: sanitizedProject,
      createdAt: existingGuestChange?.createdAt || now(),
      updatedAt: now()
    };
    savePendingChanges([
      ...pendingChanges.filter((candidate) => candidate.id !== nextChange.id),
      nextChange
    ]);
    return sendJson(response, 202, { status: "pending", project: sanitizedProject });
  }

  if (session.role !== "admin") {
    return sendJson(response, 403, { error: "ADMIN_REQUIRED" });
  }

  if (request.method === "POST" && pathname.match(/^\/api\/pending-project-changes\/[^/]+\/accept$/)) {
    const id = pathname.split("/")[3];
    const pendingChanges = loadPendingChanges();
    const change = pendingChanges.find((candidate) => candidate.id === id);
    if (!change) return sendJson(response, 404, { error: "NOT_FOUND" });
    const savedProject = saveProject(change.proposedProject);
    const remaining = pendingChanges.filter((candidate) => candidate.id !== id);
    savePendingChanges(remaining);
    return sendJson(response, 200, { project: savedProject, pendingProjectChanges: remaining });
  }

  if (request.method === "POST" && pathname.match(/^\/api\/pending-project-changes\/[^/]+\/reject$/)) {
    const id = pathname.split("/")[3];
    const pendingChanges = loadPendingChanges().filter((candidate) => candidate.id !== id);
    savePendingChanges(pendingChanges);
    return sendJson(response, 200, { project: loadProject(), pendingProjectChanges: pendingChanges });
  }

  if (request.method === "PUT" && pathname === "/api/settings") {
    const body = await readBody(request);
    const settings = {
      ...config.settings,
      guestPhotoLimit: Math.max(0, Number(body.settings?.guestPhotoLimit ?? config.settings.guestPhotoLimit ?? 50))
    };
    config = { ...config, settings, updatedAt: now() };
    writeJson(configPath, config);
    return sendJson(response, 200, { settings });
  }

  if (request.method === "PUT" && pathname === "/api/passwords") {
    const body = await readBody(request);
    const nextUsers = { ...config.users };
    ["admin", "guest"].forEach((role) => {
      const password = String(body.passwords?.[role] || "");
      if (password.trim().length >= 8) {
        nextUsers[role] = { passwordHash: hashPassword(password), updatedAt: now() };
      }
    });
    config = { ...config, users: nextUsers, updatedAt: now() };
    writeJson(configPath, config);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: "NOT_FOUND" });
}

async function handleMediamassProxy(request, response, pathname) {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }

  const mediamassPath = pathname.replace(/^\/mediamass-api/, "") || "/";
  if (!mediamassPath.startsWith("/cumpleanos/")) {
    return sendJson(response, 400, { error: "INVALID_MEDIAMASS_PATH" });
  }

  const targetUrl = `https://es.mediamass.net${mediamassPath}`;
  const proxyResponse = await fetch(targetUrl, {
    headers: {
      "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!proxyResponse.ok) {
    return sendJson(response, proxyResponse.status, { error: "MEDIAMASS_PROXY_ERROR" });
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=86400"
  });
  response.end(await proxyResponse.text());
}

async function handleExternalSourceProxy(request, response, url, proxyConfig) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const externalPath = url.pathname.replace(proxyConfig.prefix, "") || "/";
  if (proxyConfig.allowedPath && !proxyConfig.allowedPath(externalPath)) {
    return sendJson(response, 400, { error: "INVALID_PROXY_PATH" });
  }

  const targetUrl = `${proxyConfig.origin}${externalPath}${url.search}`;
  let proxyResponse = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
      Accept: proxyConfig.accept || "text/html,application/xhtml+xml,application/json,text/plain,*/*",
      ...(proxyConfig.headers || {})
    }
  });

  if (!proxyResponse.ok && proxyConfig.fallbackToReader) {
    proxyResponse = await fetch(`https://r.jina.ai/http://${targetUrl.replace(/^https?:\/\//, "")}`, {
      redirect: "follow",
      headers: {
        "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
        Accept: "text/plain,text/markdown,text/html,*/*"
      }
    });
  }

  if (!proxyResponse.ok) {
    return sendJson(response, proxyResponse.status, { error: "SOURCE_PROXY_ERROR" });
  }

  const contentType = proxyResponse.headers.get("content-type") || proxyConfig.contentType || "text/plain; charset=utf-8";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const body = Buffer.from(await proxyResponse.arrayBuffer());
  response.end(body);
}

async function handlePublicMetadataProxy(request, response, searchParams) {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }

  const targetUrl = normalizePublicMetadataUrl(searchParams.get("url") || "");
  if (!targetUrl) {
    return sendJson(response, 400, { error: "INVALID_PUBLIC_METADATA_URL" });
  }

  const proxyResponse = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!proxyResponse.ok) {
    return sendJson(response, proxyResponse.status, { error: "PUBLIC_METADATA_ERROR" });
  }

  const contentType = proxyResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    return sendJson(response, 415, { error: "PUBLIC_METADATA_UNSUPPORTED_CONTENT" });
  }

  const html = await proxyResponse.text();
  return sendJson(response, 200, parsePublicMetadata(html, proxyResponse.url || targetUrl));
}

async function handlePublicSearchProxy(request, response, searchParams) {
  if (request.method !== "GET") {
    response.writeHead(405, { Allow: "GET" });
    response.end();
    return;
  }

  const query = String(searchParams.get("query") || "").trim();
  if (!query) {
    return sendJson(response, 400, { error: "INVALID_PUBLIC_SEARCH_QUERY" });
  }

  const targetUrl = `https://r.jina.ai/http://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const searchResponse = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
      Accept: "text/plain,text/markdown,text/html,*/*"
    }
  });

  if (!searchResponse.ok) {
    return sendJson(response, searchResponse.status, { error: "PUBLIC_SEARCH_ERROR" });
  }

  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(await searchResponse.text());
}

async function handlePublicImageProxy(request, response, searchParams) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const targetUrl = normalizePublicMetadataUrl(searchParams.get("url") || "");
  if (!targetUrl) {
    return sendJson(response, 400, { error: "INVALID_PUBLIC_IMAGE_URL" });
  }

  const imageResponse = await fetch(targetUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "OpenTree/0.1 (+https://github.com/TitoTB/OpenTree)",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    }
  });

  if (!imageResponse.ok) {
    return sendJson(response, imageResponse.status, { error: "PUBLIC_IMAGE_ERROR" });
  }

  const contentType = imageResponse.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return sendJson(response, 415, { error: "PUBLIC_IMAGE_UNSUPPORTED_CONTENT" });
  }

  const body = Buffer.from(await imageResponse.arrayBuffer());
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=604800, immutable"
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function normalizePublicMetadataUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parsePublicMetadata(html, sourceUrl) {
  const title =
    readHtmlMeta(html, "property", "og:title") ||
    readHtmlMeta(html, "name", "twitter:title") ||
    readHtmlTitle(html) ||
    readHtmlFirstHeading(html);
  const snippet =
    readHtmlMeta(html, "property", "og:description") ||
    readHtmlMeta(html, "name", "twitter:description") ||
    readHtmlMeta(html, "name", "description");
  const imageUrl =
    readHtmlMeta(html, "property", "og:image") ||
    readHtmlMeta(html, "property", "og:image:secure_url") ||
    readHtmlMeta(html, "name", "twitter:image") ||
    readHtmlMeta(html, "name", "twitter:image:src") ||
    readHtmlFirstImage(html);

  return {
    title: cleanHtmlText(title),
    url: sourceUrl,
    snippet: cleanHtmlText(snippet),
    imageUrl: proxyPublicMetadataImageUrl(resolvePublicMetadataAssetUrl(imageUrl, sourceUrl))
  };
}

function readHtmlMeta(html, attribute, value) {
  const pattern = new RegExp(`<meta\\b[^>]*\\b${attribute}=["']${escapeRegExp(value)}["'][^>]*>`, "i");
  const match = html.match(pattern);
  return match ? readHtmlAttribute(match[0], "content") : "";
}

function readHtmlTitle(html) {
  return html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
}

function readHtmlFirstHeading(html) {
  return html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
}

function readHtmlFirstImage(html) {
  const match = html.match(/<img\b[^>]*>/i);
  return match ? readHtmlAttribute(match[0], "src") : "";
}

function readHtmlAttribute(tag, attribute) {
  return decodeHtmlAttribute(tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1] || "");
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function resolvePublicMetadataAssetUrl(assetUrl, sourceUrl) {
  if (!assetUrl) return "";
  try {
    return new URL(assetUrl, sourceUrl).href;
  } catch {
    return assetUrl;
  }
}

function proxyPublicMetadataImageUrl(imageUrl) {
  return imageUrl ? `/public-image?url=${encodeURIComponent(imageUrl)}` : "";
}

function cleanHtmlText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(resolve(distDir, `.${decodeURIComponent(requestedPath)}`));
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    return serveStatic(request, response, "/index.html");
  }

  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  };
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    if (url.pathname.startsWith("/mediamass-api/")) {
      await handleMediamassProxy(request, response, url.pathname);
      return;
    }
    const externalSourceProxy = externalSourceProxies.find(
      (proxyConfig) => url.pathname === proxyConfig.prefix || url.pathname.startsWith(`${proxyConfig.prefix}/`)
    );
    if (externalSourceProxy) {
      await handleExternalSourceProxy(request, response, url, externalSourceProxy);
      return;
    }
    if (url.pathname === "/public-metadata") {
      await handlePublicMetadataProxy(request, response, url.searchParams);
      return;
    }
    if (url.pathname === "/public-search") {
      await handlePublicSearchProxy(request, response, url.searchParams);
      return;
    }
    if (url.pathname === "/public-image") {
      await handlePublicImageProxy(request, response, url.searchParams);
      return;
    }
    serveStatic(request, response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "INTERNAL_ERROR" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`OpenTree listening on http://0.0.0.0:${port}`);
});
