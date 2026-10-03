// k6 load test — run:  k6 run -e BASE=http://localhost:8080 scripts/loadtest.js
// Seed first:  docker compose exec api node -e "..."  or  cd backend && npm run seed -- 5000
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '2m', target: 500 },   // 500 concurrent virtual users
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],  // the SLO claimed in the README
  },
};
const BASE = __ENV.BASE || 'http://localhost:8080';
const words = ['deployment', 'incident', 'runbook', 'latency', 'postgres', 'security', 'rollback', 'webhook'];

export function setup() {
  const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: 'editor@teamflow.dev', password: 'Passw0rd!' }), { headers: { 'Content-Type': 'application/json' } });
  return { token: r.json('token') };
}
export default function (data) {
  const h = { headers: { Authorization: `Bearer ${data.token}` } };
  const res = http.get(`${BASE}/api/documents?q=${words[Math.floor(Math.random() * words.length)]}`, h);
  check(res, { 'search 200': (r) => r.status === 200 });
  const list = http.get(`${BASE}/api/documents?limit=20`, h);
  check(list, { 'list 200': (r) => r.status === 200 });
  sleep(1);
}
