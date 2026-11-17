import { PDFParse } from "pdf-parse";
import { DocumentProcessingError, type DocumentContentItem } from "../types/document.types.js";
import { recognizeImageText } from "./image.parser.js";

export async function parsePdf(buffer: Buffer): Promise<{
  content: DocumentContentItem[];
  pageCount: number;
}> {
  const parser = new PDFParse({ data: Uint8Array.from(buffer), stopAtErrors: true });

  try {
    const result = await parser.getText();
    const content: DocumentContentItem[] = [];
    for (const page of result.pages) {
      let text = page.text.trim();
      let recognizedFromImage = false;
      if (!text) {
        const screenshot = await parser.getScreenshot({
          partial: [page.num],
          desiredWidth: 1500,
          imageBuffer: true,
          imageDataUrl: false,
        });
        const image = screenshot.pages[0]?.data;
        if (image) {
          text = await recognizeImageText(Buffer.from(image));
          recognizedFromImage = text.length > 0;
        }
      }

      if (text) {
        content.push({
          text,
          page: page.num,
          metadata: {
            pageCount: result.total,
            ...(recognizedFromImage ? { ocr: true } : {}),
          },
        });
      }
    }

    if (result.total === 0 || content.length === 0) {
      throw new DocumentProcessingError("PDF contains no readable text.");
    }

    return {
      content,
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
