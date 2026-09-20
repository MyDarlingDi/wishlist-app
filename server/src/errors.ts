/** Error carrying an HTTP status and a machine-readable code (`{ error: code }`). */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}
