export class ArcPortError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ArcPortError";
    this.status = status;
    this.body = body;
  }
}

export class ArcPortConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcPortConfigError";
  }
}

