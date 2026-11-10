import { type Request, type Response } from "express";
import {
  completeDocumentUpload,
  createDocumentUpload,
  getDocumentDetails,
  getDocumentDownloadLink,
  getDocumentExtractions,
  processDocument,
  reprocessDocumentExtractions,
  searchDocumentContent,
} from "../services/document.service.js";
import { validateSearchKeywords } from "../services/llm.service.js";
import { DocumentProcessingError } from "../types/document.types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateDocumentId(documentId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      documentId,
    )
  ) {
    throw new DocumentProcessingError("documentId must be a valid UUID.");
  }
}

function getDocumentIdParam(request: Request): string {
  const documentId = request.params.documentId;
  if (typeof documentId !== "string") {
    throw new DocumentProcessingError("documentId must be a valid UUID.");
  }

  validateDocumentId(documentId);
  return documentId;
}

export async function createUploadUrl(
  request: Request,
  response: Response,
): Promise<void> {
  const body: unknown = request.body;
  const fileName = isRecord(body) ? body.fileName : undefined;

  if (typeof fileName !== "string") {
    throw new DocumentProcessingError("fileName must be provided as a string.");
  }

  const upload = await createDocumentUpload(fileName);

  response.status(201).json({
    success: true,
    message: "Presigned upload form created",
    data: upload,
  });
}

export async function completeUpload(
  request: Request,
  response: Response,
): Promise<void> {
  const body: unknown = request.body;
  const documentId = isRecord(body) ? body.documentId : undefined;
  const fileName = isRecord(body) ? body.fileName : undefined;

  if (typeof documentId !== "string") {
    throw new DocumentProcessingError("documentId must be a valid UUID.");
  }
  validateDocumentId(documentId);

  if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 255) {
    throw new DocumentProcessingError(
      "fileName must be between 1 and 255 characters.",
    );
  }

  const document = await completeDocumentUpload(documentId, fileName);
  response.status(200).json({
    success: true,
    message: "Document upload completed and processed successfully",
    data: document,
  });
}

export async function getDocument(
  request: Request,
  response: Response,
): Promise<void> {
  const documentId = getDocumentIdParam(request);
  const document = await getDocumentDetails(documentId);

  if (!document) {
    throw new DocumentProcessingError("Document was not found.", 404);
  }

  response.json({ success: true, data: document });
}

export async function getExtractions(
  request: Request,
  response: Response,
): Promise<void> {
  const documentId = getDocumentIdParam(request);
  const extractions = await getDocumentExtractions(documentId);

  if (extractions.length === 0) {
    throw new DocumentProcessingError(
      "Extractions were not found for this document.",
      404,
    );
  }

  response.json({ success: true, data: extractions });
}

export async function extractDocumentFields(
  request: Request,
  response: Response,
): Promise<void> {
  const documentId = getDocumentIdParam(request);
  const extractions = await reprocessDocumentExtractions(documentId);
  response.json({
    success: true,
    message: "Document fields extracted and saved",
    data: extractions,
  });
}

export async function getDocumentDownload(
  request: Request,
  response: Response,
): Promise<void> {
  const documentId = getDocumentIdParam(request);
  const download = await getDocumentDownloadLink(documentId);
  response.json({ success: true, data: download });
}

export async function searchDocument(
  request: Request,
  response: Response,
): Promise<void> {
  const documentId = getDocumentIdParam(request);
  const body: unknown = request.body;
  const keywords = validateSearchKeywords(
    isRecord(body) ? body.keywords : undefined,
  );
  const data = await searchDocumentContent(documentId, keywords);

  response.json({
    success: true,
    message: "Document keyword search completed",
    data,
  });
}

export async function uploadDocument(
  request: Request,
  response: Response,
): Promise<void> {
  if (!request.file) {
    throw new DocumentProcessingError(
      "No file uploaded. Attach a PDF, CSV, XLSX, or DOCX using the 'file' field.",
    );
  }

  const document = await processDocument(request.file);

  response.status(201).json({
    success: true,
    message: "Document uploaded and processed successfully",
    data: document,
  });
}
