import "dotenv/config";
import app from "./app.js";
import {
  closeMongoConnection,
  connectToMongoDatabase,
} from "./config/mongodb.js";
import { closeS3Connection, connectToS3 } from "./config/s3.js";

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

async function startServer(): Promise<void> {
  await connectToMongoDatabase();
  console.log("MongoDB connected.");

  await connectToS3();
  console.log("S3 bucket connection verified.");

  app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`Swagger UI available at http://localhost:${port}/api-docs`);
  });
}

startServer().catch((error: unknown) => {
  console.error("Application startup failed:", error);
  void closeMongoConnection()
    .catch((cleanupError: unknown) => {
      console.error("Failed to close MongoDB after startup failure:", cleanupError);
    })
    .finally(() => {
      closeS3Connection();
      process.exitCode = 1;
    });
});
