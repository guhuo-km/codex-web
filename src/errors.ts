export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function errorToHttp(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message
        }
      }
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      }
    }
  };
}
