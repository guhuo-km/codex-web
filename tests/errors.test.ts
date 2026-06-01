import { describe, expect, test } from "vitest";
import { AppError, errorToHttp } from "../src/errors.js";

describe("errorToHttp", () => {
  test("maps AppError", () => {
    const response = errorToHttp(new AppError("Bad input", "BAD_INPUT", 400));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "Bad input"
      }
    });
  });

  test("hides unexpected error details", () => {
    const response = errorToHttp(new Error("stack detail"));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body.error.message).toBe("Internal server error");
  });
});
