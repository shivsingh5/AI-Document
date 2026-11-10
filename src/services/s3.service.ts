import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { basename } from "node:path";
import { s3Bucket, s3Client } from "../config/s3.js";
import {
  MAX_DOCUMENT_SIZE_BYTES,
  type DocumentType,
} from "../types/document.types.js";
import { S3StorageError } from "../types/s3.errors.js";

const contentTypes: Record<DocumentType, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function getDocumentObjectKey(
  documentId: string,
  originalName: string,
): string {
  const fileName = basename(originalName)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return `documents/${documentId}/${fileName || "document"}`;
}

function requireBucket(): string {
  if (!s3Bucket) {
    throw new S3StorageError("S3_BUCKET is not configured.", 500);
  }

  return s3Bucket;
}

export async function createDocumentUploadPost(
  documentId: string,
  fileName: string,
  fileType: DocumentType,
): Promise<{ key: string; url: string; fields: Record<string, string> }> {
  const key = getDocumentObjectKey(documentId, fileName);
  const contentType = contentTypes[fileType];

  try {
    const presignedPost = await createPresignedPost(s3Client, {
      Bucket: requireBucket(),
      Key: key,
      Expires: 300,
      Fields: {
        "Content-Type": contentType,
        "x-amz-server-side-encryption": "AES256",
      },
      Conditions: [
        ["content-length-range", 1, MAX_DOCUMENT_SIZE_BYTES],
        ["eq", "$Content-Type", contentType],
        ["eq", "$x-amz-server-side-encryption", "AES256"],
      ],
    });

    return { key, ...presignedPost };
  } catch (error) {
    if (error instanceof S3StorageError) {
      throw error;
    }

    throw new S3StorageError("Failed to create an S3 upload form.", 502, {
      cause: error,
    });
  }
}

export async function storeDocumentInS3(
  file: Express.Multer.File,
  documentId: string,
  fileType: DocumentType,
): Promise<{ key: string }> {
  const key = getDocumentObjectKey(documentId, file.originalname);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        Body: file.buffer,
        ContentLength: file.size,
        ContentType: contentTypes[fileType],
        ContentDisposition: "attachment",
        ServerSideEncryption: "AES256",
      }),
    );
  } catch (error) {
    throw new S3StorageError("Failed to store the document in S3.", 502, {
      cause: error,
    });
  }

  return { key };
}

export async function getDocumentFromS3(key: string): Promise<Buffer> {
  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
      }),
    );

    if (
      result.ContentLength === undefined ||
      result.ContentLength < 1 ||
      result.ContentLength > MAX_DOCUMENT_SIZE_BYTES
    ) {
      throw new S3StorageError(
        "Uploaded object is empty or exceeds the 10 MB limit.",
        400,
      );
    }

    if (!result.Body) {
      throw new S3StorageError("Uploaded object has no readable body.", 502);
    }

    const buffer = Buffer.from(await result.Body.transformToByteArray());
    if (buffer.length > MAX_DOCUMENT_SIZE_BYTES) {
      throw new S3StorageError("Uploaded object exceeds the 10 MB limit.", 400);
    }

    return buffer;
  } catch (error) {
    if (error instanceof S3StorageError) {
      throw error;
    }

    if (
      error !== null &&
      typeof error === "object" &&
      (("$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 404) ||
        ("name" in error &&
          (error.name === "NoSuchKey" || error.name === "NotFound")))
    ) {
      throw new S3StorageError(
        "Uploaded document was not found in S3. Upload the file before completing.",
        404,
        { cause: error },
      );
    }

    throw new S3StorageError("Failed to read the uploaded document from S3.", 502, {
      cause: error,
    });
  }
}

export async function createDocumentDownloadUrl(
  key: string,
  fileName: string,
): Promise<{ url: string; expiresIn: number; expiresAt: Date }> {
  const expiresIn = 300;
  const downloadName = basename(fileName).replace(/["\\\r\n]/g, "_");

  try {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: requireBucket(),
        Key: key,
        ResponseContentDisposition: `attachment; filename="${downloadName}"`,
      }),
      { expiresIn },
    );

    return {
      url,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  } catch (error) {
    if (error instanceof S3StorageError) {
      throw error;
    }

    throw new S3StorageError("Failed to create a temporary S3 download URL.", 502, {
      cause: error,
    });
  }
}
