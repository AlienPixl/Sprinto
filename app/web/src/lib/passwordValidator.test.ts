import { describe, expect, it } from "vitest";
import { validatePassword, validatePasswordMatch } from "./passwordValidator";

describe("validatePassword", () => {
  it("passes a password that meets the minimum length", () => {
    const result = validatePassword("password123");
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when password is shorter than the default minimum of 8 characters", () => {
    const result = validatePassword("abc");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password must be at least 8 characters long");
  });

  it("fails when password is shorter than a custom minimum length", () => {
    const result = validatePassword("short", 10);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password must be at least 10 characters long");
  });

  it("passes when password exactly meets the minimum length", () => {
    const result = validatePassword("12345678", 8);
    expect(result.isValid).toBe(true);
  });

  it("reports correct feedback flags", () => {
    const result = validatePassword("Hello1!");
    expect(result.feedback.hasUppercase).toBe(true);
    expect(result.feedback.hasLowercase).toBe(true);
    expect(result.feedback.hasNumber).toBe(true);
    expect(result.feedback.hasSpecialChar).toBe(true);
  });

  it("reports false feedback flags for a simple password", () => {
    const result = validatePassword("alllowercase");
    expect(result.feedback.hasUppercase).toBe(false);
    expect(result.feedback.hasNumber).toBe(false);
    expect(result.feedback.hasSpecialChar).toBe(false);
  });

  describe("with requireComplexity", () => {
    it("passes when all complexity requirements are met", () => {
      const result = validatePassword("Hello1!x", 8, true);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when uppercase is missing", () => {
      const result = validatePassword("hello1!!", 8, true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one uppercase letter");
    });

    it("fails when lowercase is missing", () => {
      const result = validatePassword("HELLO1!!", 8, true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one lowercase letter");
    });

    it("fails when number is missing", () => {
      const result = validatePassword("HelloWorld!", 8, true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one number");
    });

    it("fails when special character is missing", () => {
      const result = validatePassword("HelloWorld1", 8, true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Password must contain at least one special character");
    });

    it("accumulates multiple errors", () => {
      const result = validatePassword("abc", 8, true);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors).toContain("Password must be at least 8 characters long");
      expect(result.errors).toContain("Password must contain at least one uppercase letter");
    });

    it("does not add complexity errors when requireComplexity is false", () => {
      const result = validatePassword("alllowercase123", 8, false);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});

describe("validatePasswordMatch", () => {
  it("returns true when both passwords are identical and non-empty", () => {
    expect(validatePasswordMatch("secret123", "secret123")).toBe(true);
  });

  it("returns false when passwords differ", () => {
    expect(validatePasswordMatch("secret123", "different")).toBe(false);
  });

  it("returns false when both passwords are empty strings", () => {
    expect(validatePasswordMatch("", "")).toBe(false);
  });

  it("returns false when one password is empty", () => {
    expect(validatePasswordMatch("secret", "")).toBe(false);
  });
});
