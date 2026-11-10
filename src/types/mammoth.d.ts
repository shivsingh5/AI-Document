declare module "mammoth" {
  interface RawTextResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  const mammoth: {
    extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;
  };

  export = mammoth;
}
