import { Router } from "express";
import multer from "multer";
import {
  completeUpload,
  createUploadUrl,
  extractDocumentFields,
  getExtractions,
  getDocument,
  getDocumentDownload,
  searchDocument,
  uploadDocument,
} from "../controllers/document.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 1,
  },
});

const documentRouter = Router();

documentRouter.post("/upload-url", createUploadUrl);
documentRouter.post("/complete", completeUpload);
documentRouter.post("/upload", upload.single("file"), uploadDocument);
documentRouter.get("/:documentId/extractions", getExtractions);
documentRouter.post("/:documentId/extractions", extractDocumentFields);
documentRouter.post("/:documentId/search", searchDocument);
documentRouter.get("/:documentId/download-url", getDocumentDownload);
documentRouter.get("/:documentId", getDocument);

export default documentRouter;
