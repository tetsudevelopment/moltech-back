import type { NextFunction, Request, Response } from 'express';

import { RequestIdMiddleware } from './request-id.middleware';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes(): { setHeader: jest.Mock; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const setHeader = jest.fn((key: string, value: string) => {
    headers[key] = value;
  });
  return { setHeader, headers };
}

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    next = jest.fn();
  });

  it('reads X-Request-Id from incoming headers when present and attaches to req.id', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440000';
    const req = makeReq({ 'x-request-id': existingId });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect((req as Request & { id?: string }).id).toBe(existingId);
  });

  it('generates a UUID v4 when X-Request-Id header is absent and attaches to req.id', () => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    const id = (req as Request & { id?: string }).id;
    expect(id).toMatch(UUID_REGEX);
  });

  it('sets response header X-Request-Id with the same value', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440001';
    const req = makeReq({ 'x-request-id': existingId });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', existingId);
    expect(res.headers['X-Request-Id']).toBe(existingId);
  });

  it('sets response header X-Request-Id with the generated UUID when no header present', () => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    const id = (req as Request & { id?: string }).id;
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });

  it('calls next() exactly once', () => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('header lookup is case-insensitive (Express normalizes to lowercase)', () => {
    const existingId = '550e8400-e29b-41d4-a716-446655440002';
    // Express normalizes all headers to lowercase internally
    const req = makeReq({ 'x-request-id': existingId });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    expect((req as Request & { id?: string }).id).toBe(existingId);
  });

  it('ignores empty string X-Request-Id header and generates a new UUID', () => {
    const req = makeReq({ 'x-request-id': '' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, next);

    const id = (req as Request & { id?: string }).id;
    expect(id).toMatch(UUID_REGEX);
  });
});
