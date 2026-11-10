export type DocumentType = "pdf" | "csv" | "xlsx" | "docx";
export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

export interface DocumentContentItem {
  text: string;
  page?: number;
  row?: number;
  metadata?: Record<string, unknown>;
}

export interface DocumentContent {
  documentId: string;
  fileName: string;
  fileType: DocumentType;
  content: DocumentContentItem[];
  createdAt: Date;
  storage: {
    provider: "s3";
    key: string;
  };
}

export class DocumentProcessingError extends Error {
  public readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number = 400,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentProcessingError";
    this.statusCode = statusCode;
  }
}
