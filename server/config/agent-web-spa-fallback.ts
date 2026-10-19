import { extname } from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const SERVER_ROUTE_PREFIXES: readonly string[] = [
  '/api',
  '/webhooks',
  '/internal',
];

interface AgentWebNavigationRequest {
  method: string;
  path: string;
  accept?: string;
}

const isServerRoute = (path: string): boolean =>
  SERVER_ROUTE_PREFIXES.some((prefix: string): boolean =>
    path === prefix || path.startsWith(`${prefix}/`));

const shouldServeAgentWebSpa = (
  request: AgentWebNavigationRequest,
): boolean => {
  if (request.method.toUpperCase() !== 'GET') return false;
  if (!request.accept?.toLowerCase().includes('text/html')) return false;
  if (isServerRoute(request.path)) return false;
  return extname(request.path).length === 0;
};

const createAgentWebSpaFallback = (
  indexFilePath: string,
): RequestHandler => (
  request: Request,
  response: Response,
  next: NextFunction,
): void => {
  if (!shouldServeAgentWebSpa({
    method: request.method,
    path: request.path,
    accept: request.headers.accept,
  })) {
    next();
    return;
  }

  response.sendFile(indexFilePath, (error: Error | undefined): void => {
    if (error) next(error);
  });
};

export {
  createAgentWebSpaFallback,
  shouldServeAgentWebSpa,
};
export type { AgentWebNavigationRequest };
