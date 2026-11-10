import { PDFParse } from "pdf-parse";
import { DocumentProcessingError, type DocumentContentItem } from "../types/document.types.js";

export async function parsePdf(buffer: Buffer): Promise<{
  content: DocumentContentItem[];
  pageCount: number;
}> {
  const parser = new PDFParse({ data: Uint8Array.from(buffer), stopAtErrors: true });

  try {
    const result = await parser.getText();
    const text = result.text.trim();

    if (result.total === 0 || text.length === 0) {
      throw new DocumentProcessingError("PDF contains no readable text.");
    }

    return {
      content: [{ text, metadata: { pageCount: result.total } }],
      pageCount: result.total,
    };
  } catch (error) {
    if (error instanceof DocumentProcessingError) {
      throw error;
    }

    throw new DocumentProcessingError("PDF file could not be parsed.", 400, {
      cause: error,
    });
  } finally {
    await parser.destroy();
  }
}
