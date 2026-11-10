import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { parseCsv } from "../parsers/csv.parser.js";
import { parseDocx } from "../parsers/docx.parser.js";
import { parseExcel } from "../parsers/excel.parser.js";
import { parsePdf } from "../parsers/pdf.parser.js";
import {
  createDocumentUploadPost,
  getDocumentFromS3,
  getDocumentObjectKey,
  createDocumentDownloadUrl,
  storeDocumentInS3,
} from "./s3.service.js";
import {
  findDocumentById,
  findDocumentExtractions,
  saveDocument,
  saveDocumentExtractions,
} from "../repositories/document.repository.js";
import {
  extractDocumentFields,
  searchDocumentKeywords as findKeywordMatches,
} from "./llm.service.js";
import {
  DocumentProcessingError,
  type DocumentContent,
  type DocumentType,
} from "../types/document.types.js";

type DocumentFile = Pick<Express.Multer.File, "originalname" | "buffer" | "size">;
type ParsedDocument = Omit<DocumentContent, "storage">;

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
      throw new DocumentProcessingError(
        "Unsupported file type. Upload a PDF, CSV, XLSX, or DOCX file.",
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

  if (extension === ".pdf") {
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
      "Unsupported file type. Upload a PDF, CSV, XLSX, or DOCX file.",
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
  const fields = await extractDocumentFields(document.content);
  const storage = await storeDocumentInS3(
    file,
    documentId,
    document.fileType,
  );

  const processedDocument: DocumentContent = {
    ...document,
    storage: {
      provider: "s3",
      key: storage.key,
    },
  };
  await saveDocument(processedDocument);
  await saveDocumentFields(processedDocument, fields);
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
  const fields = await extractDocumentFields(document.content);

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
  fields: Awaited<ReturnType<typeof extractDocumentFields>>,
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

export async function getDocumentExtractions(documentId: string) {
  return findDocumentExtractions(documentId);
}

export async function reprocessDocumentExtractions(documentId: string) {
  const document = await findDocumentById(documentId);
  if (!document) {
    throw new DocumentProcessingError("Document was not found.", 404);
  }

  const fields = await extractDocumentFields(document.content);
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
