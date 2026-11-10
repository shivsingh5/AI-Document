import { TextDecoder } from "node:util";
import { parse } from "csv-parse/sync";
import {
  DocumentProcessingError,
  type DocumentContentItem,
} from "../types/document.types.js";

export function parseCsv(buffer: Buffer): DocumentContentItem[] {
  let csvText: string;

  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new DocumentProcessingError("CSV file must contain valid UTF-8 text.", 400, {
      cause: error,
    });
  }

  let records: string[][];

  try {
    records = parse(csvText, {
      bom: true,
      skip_empty_lines: false,
      relax_column_count: false,
      max_record_size: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new DocumentProcessingError("CSV file is malformed.", 400, { cause: error });
  }

  if (records.length === 0 || records[0] === undefined) {
    throw new DocumentProcessingError("CSV file is empty or has no header row.");
  }

  const headers = records[0];

  if (headers.length === 0 || headers.some((header) => header.trim().length === 0)) {
    throw new DocumentProcessingError("CSV header names must not be empty.");
  }

  if (new Set(headers).size !== headers.length) {
    throw new DocumentProcessingError("CSV header names must be unique.");
  }

  const content: DocumentContentItem[] = [];

  for (const [recordIndex, values] of records.slice(1).entries()) {
    const row = recordIndex + 2;

    if (values.every((value) => value.length === 0)) {
      continue;
    }

    if (values.length !== headers.length) {
      throw new DocumentProcessingError(
        `CSV row ${row} has ${values.length} values; expected ${headers.length}.`,
      );
    }

    const rowValues = Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );

    content.push({
      text: headers.map((header) => `${header}: ${rowValues[header]}`).join(", "),
      row,
      metadata: { values: rowValues },
    });
  }

  return content;
}
