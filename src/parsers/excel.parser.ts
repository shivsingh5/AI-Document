import ExcelJS from "exceljs";
import {
  DocumentProcessingError,
  type DocumentContentItem,
} from "../types/document.types.js";

export async function parseExcel(
  buffer: Buffer,
): Promise<DocumentContentItem[]> {
  const workbook = new ExcelJS.Workbook();

  try {
    const data = Uint8Array.from(buffer);
    await workbook.xlsx.load(data.buffer);
  } catch (error) {
    throw new DocumentProcessingError("Excel file is invalid or could not be parsed.", 400, {
      cause: error,
    });
  }

  const content: DocumentContentItem[] = [];

  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount === 0) {
      continue;
    }

    const headerRow = worksheet.getRow(1);
    const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
      headerRow.getCell(index + 1).text,
    );

    if (headers.length === 0 || headers.some((header) => header.trim().length === 0)) {
      throw new DocumentProcessingError(
        `Excel worksheet "${worksheet.name}" must have non-empty headers in the first row.`,
      );
    }

    if (new Set(headers).size !== headers.length) {
      throw new DocumentProcessingError(
        `Excel worksheet "${worksheet.name}" has duplicate headers.`,
      );
    }

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const values = headers.map((_, index) => row.getCell(index + 1).text);

      if (values.every((value) => value.length === 0)) {
        return;
      }

      const rowValues = Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      );

      content.push({
        text: headers.map((header) => `${header}: ${rowValues[header]}`).join(", "),
        row: rowNumber,
        metadata: { sheet: worksheet.name, values: rowValues },
      });
    });
  }

  if (content.length === 0) {
    throw new DocumentProcessingError("Excel file contains no data rows.");
  }

  return content;
}
