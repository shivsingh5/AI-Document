import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { parseCsv } from "../parsers/csv.parser.js";
import { parseDocx } from "../parsers/docx.parser.js";
import { parseExcel } from "../parsers/excel.parser.js";
import { parseImage } from "../parsers/image.parser.js";
import { parsePdf } from "../parsers/pdf.parser.js";
import {
  createDocumentUploadPost,
  getDocumentFromS3,
  getDocumentObjectKey,
  createDocumentDownloadUrl,
  storeDocumentInS3,
} from "./s3.service.js";
import {
  deleteDocumentData,
  findDocumentById,
  findDocumentExtractions,
  listDocuments as listStoredDocuments,
  saveDocument,
  saveDocumentExtractions,
} from "../repositories/document.repository.js";
import {
  searchDocumentKeywords as findKeywordMatches,
  verifyFieldCandidates,
} from "./llm.service.js";
import { extractDocumentFieldCandidates } from "./document-field-extractor.service.js";
import {
  DocumentProcessingError,
  type DocumentContent,
  type DocumentType,
} from "../types/document.types.js";

type DocumentFile = Pick<Express.Multer.File, "originalname" | "buffer" | "size">;
type ParsedDocument = Omit<DocumentContent, "storage">;

async function extractFields(
  document: Pick<ParsedDocument, "fileType" | "content">,
) {
  return verifyFieldCandidates(
    extractDocumentFieldCandidates(document.content),
  );
}

const supportedImageExtensions = new Set([
  ".bmp",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
]);

function isSupportedImage(buffer: Buffer): boolean {
  return (
    (buffer[0] === 0x89 &&
      buffer.subarray(1, 4).equals(Buffer.from("PNG")) &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    buffer.subarray(0, 2).equals(Buffer.from("BM")) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  );
}

export function getDocumentType(fileName: string): DocumentType {
  const extension = extname(fileName).toLowerCase();

  switch (extension) {
    case ".pdf":
      return "pdf";
    case ".csv":
      return "csv";
    case ".xlsx":
      return "xlsx";
    case ".docx":
      return "docx";
    default:
      if (supportedImageExtensions.has(extension)) {
        return "image";
      }

      throw new DocumentProcessingError(
        "Unsupported file type. Upload a PDF, CSV, XLSX, DOCX, PNG, JPG, TIFF, or BMP file.",
        415,
      );
  }
}

export async function createDocumentUpload(
  fileName: string,
): Promise<{
  documentId: string;
  fileName: string;
  fileType: DocumentType;
  upload: {
    method: "POST";
    url: string;
    fields: Record<string, string>;
    expiresIn: number;
  };
  storage: { provider: "s3"; key: string };
}> {
  const normalizedFileName = fileName.trim();
  if (!normalizedFileName || normalizedFileName.length > 255) {
    throw new DocumentProcessingError(
      "fileName must be between 1 and 255 characters.",
    );
  }

  const fileType = getDocumentType(normalizedFileName);
  const documentId = randomUUID();
  const presignedPost = await createDocumentUploadPost(
    documentId,
    normalizedFileName,
    fileType,
  );

  return {
    documentId,
    fileName: normalizedFileName,
    fileType,
    upload: {
      method: "POST",
      url: presignedPost.url,
      fields: presignedPost.fields,
      expiresIn: 300,
    },
    storage: {
      provider: "s3",
      key: presignedPost.key,
    },
  };
}

async function parseDocument(
  file: DocumentFile,
  documentId: string,
): Promise<ParsedDocument> {
  const extension = extname(file.originalname).toLowerCase();
  const header = file.buffer.subarray(0, 1024).toString("latin1");
  const isPdf = header.includes("%PDF-");
  const isZip = file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const fileType = getDocumentType(file.originalname);
  let content: DocumentContent["content"];

  if (file.size < 1) {
    throw new DocumentProcessingError("Uploaded file is empty.");
  }

  if (fileType === "image") {
    if (!isSupportedImage(file.buffer)) {
      throw new DocumentProcessingError(
        "File extension indicates an image, but the file content is not a supported image.",
      );
    }

    content = await parseImage(file.buffer);
  } else if (extension === ".pdf") {
    if (!isPdf) {
      throw new DocumentProcessingError(
        "File extension is .pdf, but the file content is not a valid PDF.",
      );
    }

    const parsedPdf = await parsePdf(file.buffer);
    content = parsedPdf.content;
  } else if (extension === ".csv") {
    if (isPdf || isZip) {
      throw new DocumentProcessingError(
        "File extension is .csv, but the file content is a PDF or Office document.",
      );
    }

    content = parseCsv(file.buffer);
  } else if (extension === ".xlsx") {
    if (!isZip) {
      throw new DocumentProcessingError(
        "File extension is .xlsx, but the file content is not a valid Excel workbook.",
      );
    }

    content = await parseExcel(file.buffer);
  } else if (extension === ".docx") {
    if (!isZip) {
      throw new DocumentProcessingError(
        "File extension is .docx, but the file content is not a valid Word document.",
      );
    }

    content = await parseDocx(file.buffer);
  } else {
    throw new DocumentProcessingError(
      "Unsupported file type. Upload a PDF, CSV, XLSX, DOCX, PNG, JPG, TIFF, or BMP file.",
      415,
    );
  }

  return {
    documentId,
    fileName: file.originalname,
    fileType,
    content,
    createdAt: new Date(),
  };
}

export async function processDocument(
  file: Express.Multer.File,
): Promise<DocumentContent> {
  const documentId = randomUUID();
  const document = await parseDocument(file, documentId);
  const fields = await extractFields(document);

  const processedDocument: DocumentContent = {
    ...document,
    storage: {
      provider: "s3",
      key: getDocumentObjectKey(documentId, file.originalname),
    },
  };
  try {
    await saveDocument(processedDocument);
    await saveDocumentFields(processedDocument, fields);
    await storeDocumentInS3(file, documentId, document.fileType);
  } catch (error) {
    try {
      await deleteDocumentData(documentId);
    } catch (cleanupError) {
      console.error(
        "Failed to clean up incomplete document records after direct upload failure:",
        cleanupError,
      );
    }
    throw error;
  }
  return processedDocument;
}

export async function completeDocumentUpload(
  documentId: string,
  fileName: string,
): Promise<DocumentContent> {
  getDocumentType(fileName);
  const key = getDocumentObjectKey(documentId, fileName);
  const buffer = await getDocumentFromS3(key);
  const document = await parseDocument(
    { originalname: fileName, buffer, size: buffer.length },
    documentId,
  );
  const fields = await extractFields(document);

  const processedDocument: DocumentContent = {
    ...document,
    storage: { provider: "s3", key },
  };
  await saveDocument(processedDocument);
  await saveDocumentFields(processedDocument, fields);
  return processedDocument;
}

async function saveDocumentFields(
  document: DocumentContent,
  fields: Awaited<ReturnType<typeof extractFields>>,
) {
  const now = new Date();
  await saveDocumentExtractions({
    documentId: document.documentId,
    fileName: document.fileName,
    fields,
    createdAt: now,
    updatedAt: now,
  });
}

export async function getDocumentDetails(documentId: string) {
  return findDocumentById(documentId);
}

export async function getDocuments() {
  return listStoredDocuments();
}

export async function getDocumentExtractions(documentId: string) {
  return findDocumentExtractions(documentId);
}

export async function reprocessDocumentExtractions(documentId: string) {
  const document = await findDocumentById(documentId);
  if (!document) {
    throw new DocumentProcessingError("Document was not found.", 404);
  }

  const fields = await extractFields(document);
  const existing = await findDocumentExtractions(documentId);
  const now = new Date();
  await saveDocumentExtractions({
    documentId,
    fileName: document.fileName,
    fields,
    createdAt: existing[0]?.createdAt ?? now,
    updatedAt: now,
  });

  return findDocumentExtractions(documentId);
}

export async function searchDocumentContent(
  documentId: string,
  keywords: string[],
) {
  const document = await findDocumentById(documentId);
  if (!document) {
    throw new DocumentProcessingError("Document was not found.", 404);
  }

  const search = await findKeywordMatches(document.content, keywords);
  return {
    documentId: document.documentId,
    fileName: document.fileName,
    keywords,
    ...search,
  };
}

export async function getDocumentDownloadLink(documentId: string) {
  const document = await findDocumentById(documentId);
  if (!document) {
    throw new DocumentProcessingError("Document was not found.", 404);
  }

  const download = await createDocumentDownloadUrl(
    document.storage.key,
    document.fileName,
  );

  return {
    documentId: document.documentId,
    fileName: document.fileName,
    url: download.url,
    expiresIn: download.expiresIn,
    expiresAt: download.expiresAt,
  };
}
