import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createWorker } from "tesseract.js";
import {
  DocumentProcessingError,
  type DocumentContentItem,
} from "../types/document.types.js";

export async function recognizeImageText(buffer: Buffer): Promise<string> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    const cachePath = resolve(process.cwd(), "node_modules/.cache/tesseract.js");
    await mkdir(cachePath, { recursive: true });
    worker = await createWorker("eng", undefined, { cachePath });
    const result = await worker.recognize(buffer);
    return result.data.text.trim();
  } catch (error) {
    if (error instanceof DocumentProcessingError) {
      throw error;
    }

    throw new DocumentProcessingError(
      "Image OCR failed. Verify the image is valid and the local OCR engine can start.",
      422,
      { cause: error },
    );
  } finally {
    await worker?.terminate();
  }
}

export async function parseImage(
  buffer: Buffer,
): Promise<DocumentContentItem[]> {
  const text = await recognizeImageText(buffer);
  if (!text) {
    throw new DocumentProcessingError(
      "Image contains no readable text. Upload a clearer image and try again.",
    );
  }

  return [{ text }];
}
