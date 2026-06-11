// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, createWsRateLimiter, keyByIp, keyByUserId } from "./rate-limit.js";

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "user-1" },
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as import("express").Request;
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

describe("createRateLimiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, keyFn: keyByUserId });
    const req = mockReq();
    const res = mockRes();
    let nextCalled = 0;

    for (let i = 0; i < 3; i++) {
      limiter(req, res as never, () => { nextCalled++; });
    }

    expect(nextCalled).toBe(3);
    expect(res.statusCode).toBe(200);
  });

  it("blocks the request that exceeds the limit with 429", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, keyFn: keyByUserId });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    for (let i = 0; i < 3; i++) limiter(req, res as never, next);
    limiter(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBeTruthy();
  });

  it("resets the count after the window expires", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, keyFn: keyByUserId });
    const req = mockReq();
    const next = vi.fn();

    limiter(req, mockRes() as never, next);
    limiter(req, mockRes() as never, next);

    // advance past the window
    vi.advanceTimersByTime(1001);

    const res = mockRes();
    limiter(req, res as never, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(200);
  });

  it("tracks different users independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, keyFn: keyByUserId });
    const next = vi.fn();

    limiter(mockReq({ user: { id: "user-a" } }), mockRes() as never, next);
    limiter(mockReq({ user: { id: "user-b" } }), mockRes() as never, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("uses the custom error message", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, keyFn: keyByUserId, message: "Slow down!" });
    const req = mockReq();
    const res = mockRes();

    limiter(req, mockRes() as never, vi.fn());
    limiter(req, res as never, vi.fn());

    expect((res.body as { error: string }).error).toBe("Slow down!");
  });

  it("skips limiting when keyFn returns null", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, keyFn: () => null });
    const next = vi.fn();

    limiter(mockReq(), mockRes() as never, next);
    limiter(mockReq(), mockRes() as never, next);
    limiter(mockReq(), mockRes() as never, next);

    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe("keyByUserId", () => {
  it("returns the user id when present", () => {
    expect(keyByUserId(mockReq())).toBe("user-1");
  });

  it("returns null when there is no user", () => {
    expect(keyByUserId(mockReq({ user: null }))).toBeNull();
  });
});

describe("keyByIp", () => {
  it("returns the remote address", () => {
    expect(keyByIp(mockReq())).toBe("127.0.0.1");
  });

  it("uses the first value from x-forwarded-for when present", () => {
    const req = mockReq({ headers: { "x-forwarded-for": "10.0.0.1, 192.168.1.1" } });
    expect(keyByIp(req)).toBe("10.0.0.1");
  });

  it("falls back to 'unknown' when no address is available", () => {
    const req = mockReq({ headers: {}, socket: {} });
    expect(keyByIp(req)).toBe("unknown");
  });
});

describe("createWsRateLimiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows messages under the limit", () => {
    const check = createWsRateLimiter({ limit: 3, windowMs: 1000 });
    const socket = {} as never;

    expect(check(socket)).toBe(true);
    expect(check(socket)).toBe(true);
    expect(check(socket)).toBe(true);
  });

  it("returns false when the limit is exceeded", () => {
    const check = createWsRateLimiter({ limit: 2, windowMs: 1000 });
    const socket = {} as never;

    check(socket);
    check(socket);

    expect(check(socket)).toBe(false);
  });

  it("allows messages again after the window expires", () => {
    const check = createWsRateLimiter({ limit: 2, windowMs: 1000 });
    const socket = {} as never;

    check(socket);
    check(socket);
    vi.advanceTimersByTime(1001);

    expect(check(socket)).toBe(true);
  });

  it("tracks separate sockets independently", () => {
    const check = createWsRateLimiter({ limit: 1, windowMs: 1000 });
    const socketA = {} as never;
    const socketB = {} as never;

    check(socketA);

    expect(check(socketB)).toBe(true);
  });
});
