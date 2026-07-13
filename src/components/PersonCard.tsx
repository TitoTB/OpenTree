import type { CSSProperties } from "react";
import type { ClinicalCondition, ClinicalConditionCategory, DisplaySettings, Person } from "../domain/types";
import { fullName } from "../tree/layout";

export interface LifeLabels {
  years: string;
  deceased: string;
  noDate: string;
  noClinicalConditions: string;
}

interface PersonCardProps {
  person: Person;
  selected: boolean;
  compact?: boolean;
  lifeLabels: LifeLabels;
  displaySettings: DisplaySettings;
  clinicalConditions: ClinicalCondition[];
  clinicalCategories?: ClinicalConditionCategory[];
  flagPortraitUrl?: string;
  onSelect: (person: Person) => void;
}

export function PersonCard({
  person,
  selected,
  compact = false,
  lifeLabels,
  displaySettings,
  clinicalConditions,
  clinicalCategories = [],
  flagPortraitUrl,
  onSelect
}: PersonCardProps) {
  const lifeStatus = getLifeStatus(person, lifeLabels);
  const linkedClinicalConditions = (person.clinicalConditionIds ?? [])
    .map((conditionId) => clinicalConditions.find((condition) => condition.id === conditionId))
    .filter((condition): condition is ClinicalCondition => Boolean(condition));
  const clinicalStatus =
    linkedClinicalConditions.length > 0
      ? linkedClinicalConditions.map((condition) => condition.name).join(", ")
      : lifeLabels.noClinicalConditions;
  const visualGender = displaySettings.colorByGender ? person.gender : "neutral";
  const portraitImage = flagPortraitUrl || (displaySettings.showPhotos ? person.photoUrl : "");
  const showPhoto = Boolean(portraitImage);
  const showDeceasedSymbol = displaySettings.showDeceasedSymbol && isDeceased(person);
  const showClinicalConditions = Boolean(displaySettings.showClinicalConditions);
  const hasClinicalConditions = linkedClinicalConditions.length > 0;
  const clinicalCategory = linkedClinicalConditions
    .map((condition) => clinicalCategories.find((category) => category.id === condition.categoryId))
    .find((category): category is ClinicalConditionCategory => Boolean(category));
  const clinicalStyle =
    showClinicalConditions && hasClinicalConditions && clinicalCategory
      ? ({
          "--clinical-color": clinicalCategory.color,
          "--clinical-bg": softenColor(clinicalCategory.color)
        } as CSSProperties)
      : undefined;
  const cardStyle = { ...(clinicalStyle ?? {}) } as CSSProperties;

  return (
    <button
      className={`person-card gender-${visualGender} ${flagPortraitUrl ? "has-flag-portrait" : ""} ${selected ? "selected" : ""} ${compact ? "compact" : ""} ${
        showClinicalConditions ? `clinical-mode ${hasClinicalConditions ? "clinical-has-conditions" : "clinical-none"}` : ""
      }`}
      style={cardStyle}
      type="button"
      onClick={() => onSelect(person)}
    >
      <span className="portrait" style={{ backgroundImage: showPhoto ? `url(${portraitImage})` : undefined }}>
        {showPhoto ? <img src={portraitImage} alt="" aria-hidden="true" /> : person.givenName.slice(0, 1)}
      </span>
      <span className="person-copy">
        <strong>{fullName(person)}</strong>
        <small>{showClinicalConditions ? clinicalStatus : lifeStatus}</small>
      </span>
      {showDeceasedSymbol ? (
        <span className="deceased-symbol" title={lifeLabels.deceased} aria-label={lifeLabels.deceased}>
          †
        </span>
      ) : null}
    </button>
  );
}

function isDeceased(person: Person) {
  return Boolean(person.isDeceased || person.deathDate || person.deathPlace);
}

export function getLifeStatus(person: Person, labels: LifeLabels) {
  const birthDate = parseDate(person.birthDate);
  const deathDate = parseDate(person.deathDate);

  if (isDeceased(person)) {
    const age = birthDate && deathDate ? calculateAge(birthDate, deathDate) : null;
    return age === null ? labels.deceased : `${labels.deceased}, ${age} ${labels.years}`;
  }

  if (birthDate) {
    return `${calculateAge(birthDate, new Date())} ${labels.years}`;
  }

  return labels.noDate;
}

function parseDate(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) {
    return createDate(Number(dayFirst[3]), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const yearFirst = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (yearFirst) {
    return createDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  const yearOnly = trimmed.match(/^(\d{4})$/);
  if (yearOnly) {
    return createDate(Number(yearOnly[1]), 1, 1);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function calculateAge(start: Date, end: Date) {
  let age = end.getFullYear() - start.getFullYear();
  const hasBirthdayPassed =
    end.getMonth() > start.getMonth() || (end.getMonth() === start.getMonth() && end.getDate() >= start.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return Math.max(0, age);
}

function softenColor(color: string) {
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return "#fff6d9";

  const hex = match[1];
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, 0.18)`;
}
