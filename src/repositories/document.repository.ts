import {
  getDocumentsCollection,
  getExtractionsCollection,
  MongoStorageError,
  type ExtractionField,
  type StoredExtraction,
  type StoredDocument,
} from "../config/mongodb.js";
import type { DocumentContent } from "../types/document.types.js";
import type { ExtractedDocumentFields } from "../services/llm.service.js";

export async function saveDocument(
  document: DocumentContent,
): Promise<void> {
  const collection = await getDocumentsCollection();
  const storedDocument: StoredDocument = {
    ...document,
    createdAt: new Date(document.createdAt),
  };

  try {
    await collection.replaceOne(
      { documentId: document.documentId },
      storedDocument,
      { upsert: true },
    );
  } catch (error) {
    throw new MongoStorageError("Could not save document metadata in MongoDB.", {
      cause: error,
    });
  }
}

export async function findDocumentById(
  documentId: string,
): Promise<StoredDocument | null> {
  const collection = await getDocumentsCollection();
  try {
    return await collection.findOne(
      { documentId },
      {
        projection: {
          _id: 0,
          documentId: 1,
          fileName: 1,
          fileType: 1,
          content: 1,
          createdAt: 1,
          storage: 1,
        },
      },
    );
  } catch (error) {
    throw new MongoStorageError("Could not retrieve document metadata from MongoDB.", {
      cause: error,
    });
  }
}

export async function saveDocumentExtractions(
  extractions: {
    documentId: string;
    fileName: string;
    fields: ExtractedDocumentFields;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<void> {
  const collection = await getExtractionsCollection();
  try {
    const fields: ExtractionField[] = [
      "state",
      "zipCode",
      "netIncome",
      "entityName",
    ];

    await Promise.all(
      fields.map(async (field) => {
        const extraction = extractions.fields[field];
        const record: Omit<StoredExtraction, "_id"> = {
          documentId: extractions.documentId,
          fileName: extractions.fileName,
          field,
          value: extraction.value,
          evidence: extraction.evidence,
          source: extraction.source,
          createdAt: extractions.createdAt,
          updatedAt: extractions.updatedAt,
        };
        await collection.replaceOne(
          { documentId: extractions.documentId, field },
          record,
          { upsert: true },
        );
      }),
    );

    await collection.deleteOne({
      documentId: extractions.documentId,
      field: { $exists: false },
    });
  } catch (error) {
    throw new MongoStorageError("Could not save document extractions in MongoDB.", {
      cause: error,
    });
  }
}

export async function findDocumentExtractions(
  documentId: string,
): Promise<StoredExtraction[]> {
  const collection = await getExtractionsCollection();
  try {
    return await collection
      .find(
      { documentId },
      {
        projection: {
          _id: 0,
          documentId: 1,
          fileName: 1,
          field: 1,
          value: 1,
          evidence: 1,
          source: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      )
      .sort({ field: 1 })
      .toArray();
  } catch (error) {
    throw new MongoStorageError(
      "Could not retrieve document extractions from MongoDB.",
      { cause: error },
    );
  }
}
