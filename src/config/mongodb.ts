import "dotenv/config";
import {
  MongoClient,
  type Collection,
  type Db,
  type Document,
} from "mongodb";
import type { DocumentContent } from "../types/document.types.js";

export interface StoredDocument extends DocumentContent, Document {
  storage: {
    provider: "s3";
    key: string;
  };
}

export interface FieldExtraction {
  value: string | null;
  evidence: string | null;
  source: {
    contentIndex: number;
    page?: number;
    row?: number;
    part?: number;
  } | null;
}

export type ExtractionField =
  | "state"
  | "zipCode"
  | "netIncome"
  | "entityName";

export interface StoredExtraction extends Document {
  documentId: string;
  fileName: string;
  field: ExtractionField;
  value: FieldExtraction["value"];
  evidence: FieldExtraction["evidence"];
  source: FieldExtraction["source"];
  createdAt: Date;
  updatedAt: Date;
}

export class MongoStorageError extends Error {
  public readonly statusCode: number;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MongoStorageError";
    this.statusCode = 503;
  }
}

let databasePromise: Promise<Db> | undefined;
let documentsCollectionPromise: Promise<Collection<StoredDocument>> | undefined;
let extractionsCollectionPromise: Promise<Collection<StoredExtraction>> | undefined;
let mongoClient: MongoClient | undefined;

export async function connectToMongoDatabase(): Promise<void> {
  await Promise.all([getDocumentsCollection(), getExtractionsCollection()]);
}

async function getDatabase(): Promise<Db> {
  if (!databasePromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new MongoStorageError("MONGODB_URI is not configured.");
    }

    const databaseName = process.env.MONGODB_DATABASE ?? "document_search";
    const client = new MongoClient(uri);
    mongoClient = client;

    databasePromise = client
      .connect()
      .then(() => client.db(databaseName))
      .catch((error: unknown) => {
        databasePromise = undefined;
        mongoClient = undefined;
        void client.close();
        throw new MongoStorageError(
          "Could not connect to MongoDB.",
          { cause: error },
        );
      });
  }

  return databasePromise;
}

export async function getDocumentsCollection(): Promise<Collection<StoredDocument>> {
  if (!documentsCollectionPromise) {
    documentsCollectionPromise = getDatabase()
      .then(async (database) => {
        const collection = database.collection<StoredDocument>("document");
        await collection.createIndex({ documentId: 1 }, { unique: true });
        return collection;
      })
      .catch((error: unknown) => {
        documentsCollectionPromise = undefined;
        if (error instanceof MongoStorageError) {
          throw error;
        }
        throw new MongoStorageError(
          "Could not initialize the document collection.",
          { cause: error },
        );
      });
  }

  return documentsCollectionPromise;
}

export async function getExtractionsCollection(): Promise<
  Collection<StoredExtraction>
> {
  if (!extractionsCollectionPromise) {
    extractionsCollectionPromise = getDatabase()
      .then(async (database) => {
        const collection =
          database.collection<StoredExtraction>("extractions");
        const indexes = await collection.listIndexes().toArray();
        for (const index of indexes) {
          const keys = Object.entries(index.key ?? {});
          if (
            index.unique === true &&
            keys.length === 1 &&
            keys[0]?.[0] === "documentId" &&
            index.name
          ) {
            await collection.dropIndex(index.name);
          }
        }
        await collection.createIndex(
          { documentId: 1, field: 1 },
          { unique: true },
        );
        await migrateLegacyExtractions(collection);
        return collection;
      })
      .catch((error: unknown) => {
        extractionsCollectionPromise = undefined;
        if (error instanceof MongoStorageError) {
          throw error;
        }
        throw new MongoStorageError(
          "Could not initialize the extractions collection.",
          { cause: error },
        );
      });
  }

  return extractionsCollectionPromise;
}

async function migrateLegacyExtractions(
  collection: Collection<StoredExtraction>,
): Promise<void> {
  const legacyRecords = await collection
    .find({ field: { $exists: false }, fields: { $exists: true } })
    .toArray();

  for (const legacy of legacyRecords) {
    const legacyFields = legacy.fields as
      | Record<string, FieldExtraction>
      | undefined;
    if (!legacyFields || typeof legacy.documentId !== "string") {
      continue;
    }

    const createdAt =
      legacy.createdAt instanceof Date ? legacy.createdAt : new Date();
    const updatedAt =
      legacy.updatedAt instanceof Date ? legacy.updatedAt : createdAt;
    for (const field of [
      "state",
      "zipCode",
      "netIncome",
      "entityName",
    ] as const) {
      const extraction = legacyFields[field];
      if (!extraction) {
        continue;
      }

      await collection.replaceOne(
        { documentId: legacy.documentId, field },
        {
          documentId: legacy.documentId,
          fileName: typeof legacy.fileName === "string" ? legacy.fileName : "",
          field,
          value: extraction.value ?? null,
          evidence: extraction.evidence ?? null,
          source: extraction.source ?? null,
          createdAt,
          updatedAt,
        },
        { upsert: true },
      );
    }

    await collection.deleteOne({
      documentId: legacy.documentId,
      field: { $exists: false },
    });
  }
}

export async function closeMongoConnection(): Promise<void> {
  if (!mongoClient) {
    return;
  }

  const client = mongoClient;
  mongoClient = undefined;
  databasePromise = undefined;
  documentsCollectionPromise = undefined;
  extractionsCollectionPromise = undefined;
  await client.close();
}
