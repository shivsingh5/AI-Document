export class S3StorageError extends Error {
  public readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "S3StorageError";
    this.statusCode = statusCode;
  }
}
