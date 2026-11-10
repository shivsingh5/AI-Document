import "dotenv/config";
import { GetBucketLocationCommand, S3Client } from "@aws-sdk/client-s3";
import { S3StorageError } from "../types/s3.errors.js";

export const s3Bucket = process.env.S3_BUCKET;

export const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
});

export async function connectToS3(): Promise<void> {
  if (!s3Bucket) {
    throw new S3StorageError("S3_BUCKET is not configured.", 500);
  }

  try {
    await s3Client.send(new GetBucketLocationCommand({ Bucket: s3Bucket }));
  } catch (error) {
    throw new S3StorageError(
      "Could not verify access to the configured S3 bucket. Check AWS credentials, AWS_REGION, S3_BUCKET, and s3:GetBucketLocation permission.",
      503,
      { cause: error },
    );
  }
}

export function closeS3Connection(): void {
  s3Client.destroy();
}
