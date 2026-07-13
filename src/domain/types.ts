export type Locale = "es" | "en" | "ca" | "gl" | "eu";

export type PersonId = string;

export type RelationshipKind =
  | "parent_child"
  | "partner"
  | "spouse"
  | "former_spouse"
  | "adoptive_parent"
  | "guardian";

export type Gender = "female" | "male" | "non_binary" | "unknown";

export interface LifeEvent {
  id: string;
  type: "birth" | "death" | "marriage" | "divorce" | "residence" | "custom";
  date?: string;
  place?: string;
  description?: string;
}

export interface Person {
  id: PersonId;
  givenName: string;
  familyName: string;
  gender: Gender;
  birthDate?: string;
  birthTime?: string;
  birthCity?: string;
  birthCountry?: string;
  birthPlace?: string;
  birthLatitude?: number;
  birthLongitude?: number;
  isDeceased?: boolean;
  deathDate?: string;
  deathCity?: string;
  deathCountry?: string;
  deathPlace?: string;
  photoUrl?: string;
  notes?: string;
  clinicalConditionIds?: string[];
  publicInfoLinks?: PublicInfoLink[];
  events: LifeEvent[];
}

export interface PublicInfoLink {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  imageUrl?: string;
  status: "pending" | "accepted";
  createdAt: string;
}

export interface ClinicalCondition {
  id: string;
  name: string;
  categoryId?: string;
  description?: string;
  symptoms?: string;
  sourceUrl?: string;
  sourceName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalConditionCategory {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface GalleryFaceRegion {
  id: string;
  personId: PersonId;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GalleryPhoto {
  id: string;
  title?: string;
  dataUrl: string;
  fileName?: string;
  takenAt?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  personIds: PersonId[];
  faceRegions?: GalleryFaceRegion[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorldHistoryEntry {
  key: string;
  dateKey: string;
  year: number;
  text: string;
  sourceName: "Wikimedia";
  sourceUrl: string;
  fetchedAt: string;
}

export type ContributionStatus = "pending" | "accepted" | "rejected";

export interface ContributionPersonPatch {
  givenName?: string;
  familyName?: string;
  gender?: Gender;
  birthDate?: string;
  birthTime?: string;
  birthCity?: string;
  birthCountry?: string;
  birthPlace?: string;
  birthLatitude?: number;
  birthLongitude?: number;
  isDeceased?: boolean;
  deathDate?: string;
  deathCity?: string;
  deathCountry?: string;
  deathPlace?: string;
  notes?: string;
}

export interface ContributionRecord {
  id: string;
  format: "opentree-contribution-response";
  version: number;
  requestId: string;
  targetPersonId: PersonId;
  submittedAt: string;
  importedAt: string;
  status: ContributionStatus;
  contributorName?: string;
  contributorEmail?: string;
  comment?: string;
  source?: {
    type: "manual" | "external";
    title?: string;
    url?: string;
    archive?: string;
    signature?: string;
    date?: string;
    notes?: string;
  };
  personPatch: ContributionPersonPatch;
  relatedPatches?: Array<{
    targetPersonId: PersonId;
    relationshipLabel: string;
    personPatch: ContributionPersonPatch;
  }>;
}

export interface Relationship {
  id: string;
  kind: RelationshipKind;
  fromPersonId: PersonId;
  toPersonId: PersonId;
  startDate?: string;
  endDate?: string;
  notes?: string;
}

export interface DisplaySettings {
  colorByGender: boolean;
  showPhotos: boolean;
  showDeceasedSymbol: boolean;
  showGenerationLines: boolean;
  showSaintDays: boolean;
  showClinicalConditions?: boolean;
  darkMode?: boolean;
  treeStyle?: "neutral" | "medieval" | "epic" | "japanese";
}

export interface SurnameIneStats {
  surname: string;
  totalFirst?: number;
  totalSecond?: number;
  totalBoth?: number;
  frequencyFirst?: number;
  frequencySecond?: number;
  frequencyBoth?: number;
  provinceFirst?: Array<{ id: number; name: string; value: number; unit: string }>;
  provinceSecond?: Array<{ id: number; name: string; value: number; unit: string }>;
  provinceBoth?: Array<{ id: number; name: string; value: number; unit: string }>;
  sourceName: "INE";
  sourceUrl: string;
  fetchedAt: string;
}

export interface SurnameForebearsStats {
  surname: string;
  worldRank?: number;
  totalWorld?: number;
  mostPrevalentCountry?: string;
  highestDensityCountry?: string;
  countries: Array<{
    country: string;
    incidence?: number;
    frequency?: string;
    rank?: number;
  }>;
  sourceName: "Forebears";
  sourceUrl: string;
  fetchedAt: string;
}

export interface SurnameOriginSuggestion {
  id: string;
  sourceName: "Geneanet" | "Wikipedia" | "Wikidata";
  sourceUrl: string;
  title: string;
  origin?: string;
  meaning?: string;
  excerpt: string;
  language?: string;
  status: "pending" | "accepted" | "rejected";
  fetchedAt: string;
}

export interface SurnameProfile {
  surname: string;
  origin?: string;
  meaning?: string;
  history?: string;
  variants?: string;
  heraldry?: string;
  notes?: string;
  confidence?: "low" | "medium" | "high";
  ine?: SurnameIneStats;
  forebears?: SurnameForebearsStats;
  coatOfArmsUrl?: string;
  coatOfArmsSourceUrl?: string;
  coatOfArmsFetchedAt?: string;
  originSuggestions?: SurnameOriginSuggestion[];
  originSourceName?: string;
  originSourceUrl?: string;
}

export interface GivenNameProfile {
  name: string;
  meaning?: string;
  originalMeaning?: string;
  sourceName: "Ancestry" | "Behind the Name";
  sourceUrl: string;
  fetchedAt: string;
}

export interface FamousBirthMatch {
  name: string;
  sourceUrl: string;
  wikipediaUrl?: string;
}

export interface TreeProject {
  id: string;
  name: string;
  locale: Locale;
  people: Person[];
  relationships: Relationship[];
  contributions?: ContributionRecord[];
  surnameProfiles?: Record<string, SurnameProfile>;
  nameProfiles?: Record<string, GivenNameProfile>;
  clinicalConditions?: ClinicalCondition[];
  clinicalConditionCategories?: ClinicalConditionCategory[];
  galleryPhotos?: GalleryPhoto[];
  pendingGalleryPhotos?: GalleryPhoto[];
  worldHistoryEvents?: Record<string, WorldHistoryEntry[]>;
  famousBirths?: Record<string, FamousBirthMatch | null>;
  displaySettings?: DisplaySettings;
  contributionRequestMessage?: string;
  createdAt: string;
  updatedAt: string;
}
