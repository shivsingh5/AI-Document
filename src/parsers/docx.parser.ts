import mammoth from "mammoth";
import {
  DocumentProcessingError,
  type DocumentContentItem,
} from "../types/document.types.js";

export async function parseDocx(
  buffer: Buffer,
): Promise<DocumentContentItem[]> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();

    if (text.length === 0) {
      throw new DocumentProcessingError("DOCX file contains no readable text.");
    }

    return [{ text }];
  } catch (error) {
    if (error instanceof DocumentProcessingError) {
      throw error;
    }

    throw new DocumentProcessingError("DOCX file is invalid or could not be parsed.", 400, {
      cause: error,
    });
  }
}
