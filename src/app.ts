import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { parse } from "yaml";
import { MongoStorageError } from "./config/mongodb.js";
import documentRouter from "./routes/document.routes.js";
import { DocumentProcessingError } from "./types/document.types.js";
import { S3StorageError } from "./types/s3.errors.js";
import { LlmServiceError } from "./services/llm.service.js";

const app = express();
const openApiYaml = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
const openApiSpec = parse(openApiYaml);
const frontendDirectory = fileURLToPath(new URL("../public/", import.meta.url));

app.use(express.json({ limit: "16kb" }));
app.get("/", (_request: Request, response: Response) => {
  response.sendFile(fileURLToPath(new URL("../public/index.html", import.meta.url)));
});
app.get("/health", (_request: Request, response: Response) => {
  response.send("Document upload API is running.");
});
app.get("/openapi.yaml", (_request: Request, response: Response) => {
  response.type("application/yaml").send(openApiYaml);
});
app.use(express.static(frontendDirectory));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.use("/api/documents", documentRouter);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const statusCode = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "File exceeds the 10 MB upload limit."
        : error.code === "LIMIT_UNEXPECTED_FILE"
          ? "Unexpected upload field. Use the 'file' field."
          : error.message;

    response.status(statusCode).json({ success: false, message });
    return;
  }

  if (error instanceof DocumentProcessingError) {
    response
      .status(error.statusCode)
      .json({ success: false, message: error.message });
    return;
  }

  if (error instanceof S3StorageError) {
    console.error("S3 storage error:", error);
    response
      .status(error.statusCode)
      .json({ success: false, message: error.message });
    return;
  }

  if (error instanceof MongoStorageError) {
    console.error("MongoDB storage error:", error);
    response
      .status(error.statusCode)
      .json({ success: false, message: error.message });
    return;
  }

  if (error instanceof LlmServiceError) {
    if (error.statusCode >= 500) {
      console.error("LLM processing error:", error);
    }
    response
      .status(error.statusCode)
      .json({ success: false, message: error.message });
    return;
  }

  console.error("Unhandled application error:", error);
  response.status(500).json({
    success: false,
    message: "An unexpected error occurred while processing the upload.",
  });
};

app.use(errorHandler);

export default app;
