import type { FieldExtraction } from "../config/mongodb.js";
import type { DocumentContentItem } from "../types/document.types.js";
import type { ExtractedDocumentFields } from "./llm.service.js";

const stateNames = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
];
const stateAbbreviations = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

interface Candidate {
  value: string;
  evidence: string;
  source: FieldExtraction["source"];
}

function getState(line: string): string | undefined {
  const labeledValue = line.match(
    /\bstate(?:\s+of\s+(?:residence|formation|incorporation))?\s*[:#=-]?\s*(.+)$/i,
  )?.[1]?.trim();
  if (!labeledValue) {
    return undefined;
  }

  const normalized = labeledValue.replace(/^[,;\s]+/, "");
  const fullName = stateNames.find((name) =>
    new RegExp(`^${name.replaceAll(" ", "\\s+")}(?=$|[,;\\s])`, "i").test(
      normalized,
    ),
  );
  if (fullName) {
    return normalized.match(
      new RegExp(`^${fullName.replaceAll(" ", "\\s+")}`, "i"),
    )?.[0];
  }

  const abbreviation = normalized.match(/^[A-Za-z]{2}(?=$|[,;\s])/)?.[0]
    ?.toUpperCase();
  if (!abbreviation) {
    return undefined;
  }
  return stateAbbreviations.has(abbreviation) ? abbreviation : undefined;
}

function getZipCode(line: string): string | undefined {
  return line.match(
    /\b(?:zip(?:\s*code)?|postal(?:\s*code)?)\s*[:#=-]?\s*(\d{5}(?:-\d{4})?)\b/i,
  )?.[1];
}

function getNetIncome(line: string): string | undefined {
  const value = line.match(
    /\bnet\s+income\b\s*[:#=-]?\s*(\(?-?\s*\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?(?:\s*(?:per\s+month|monthly|annually|annual|per\s+year|yearly))?)/i,
  )?.[1];
  return value?.trim().replace(/\s+/g, " ");
}

function getEntityName(line: string): string | undefined {
  const llcIndex = line.search(/\bLLC\b/i);
  if (llcIndex < 0) {
    return undefined;
  }

  let prefix = line.slice(0, llcIndex + 3);
  const label = prefix.match(
    /(?:entity|company|business)\s+name\s*[:#=-]\s*(.+)$/i,
  );
  if (label) {
    prefix = label[1];
  } else {
    prefix = prefix.split(/[:|;]/).at(-1) ?? prefix;
    prefix = prefix.replace(/^.*?\b(?:is|known as|named)\s+/i, "");
  }

  const name = prefix.trim().replace(/\s+/g, " ");
  return name.length > 3 && /\bLLC\b$/i.test(name) ? name : undefined;
}

function getEvidence(line: string, value: string): string {
  if (line.length <= 500) {
    return line;
  }

  const valueIndex = line.toLocaleLowerCase().indexOf(value.toLocaleLowerCase());
  const start = Math.max(0, valueIndex - 200);
  return line.slice(start, start + 500).trim();
}

function findCandidate(
  content: DocumentContentItem[],
  extract: (line: string) => string | undefined,
): Candidate | undefined {
  for (const [contentIndex, item] of content.entries()) {
    for (const line of item.text.split(/\r?\n/)) {
      const evidence = line.trim();
      if (!evidence) {
        continue;
      }

      const value = extract(evidence);
      if (value) {
        return {
          value,
          evidence: getEvidence(evidence, value),
          source: {
            contentIndex: contentIndex + 1,
            ...(item.page === undefined ? {} : { page: item.page }),
            ...(item.row === undefined ? {} : { row: item.row }),
          },
        };
      }
    }
  }

  return undefined;
}

function toFieldExtraction(candidate?: Candidate): FieldExtraction {
  return candidate
    ? {
        value: candidate.value,
        evidence: candidate.evidence,
        source: candidate.source,
      }
    : { value: null, evidence: null, source: null };
}

export function extractDocumentFieldCandidates(
  content: DocumentContentItem[],
): ExtractedDocumentFields {
  return {
    state: toFieldExtraction(findCandidate(content, getState)),
    zipCode: toFieldExtraction(findCandidate(content, getZipCode)),
    netIncome: toFieldExtraction(findCandidate(content, getNetIncome)),
    entityName: toFieldExtraction(findCandidate(content, getEntityName)),
  };
}
