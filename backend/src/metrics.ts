import client from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const latency = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'HTTP latency', labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2.5, 5], registers: [registry],
});
export const webhookCounter = new client.Counter({
  name: 'webhook_deliveries_total', help: 'Outbound webhook delivery attempts', labelNames: ['result'], registers: [registry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = latency.startTimer();
  res.on('finish', () => {
    const route = (req.baseUrl + (req.route?.path ?? '')) || 'unmatched';
    end({ method: req.method, route, status: String(res.statusCode) });
  });
  next();
}
