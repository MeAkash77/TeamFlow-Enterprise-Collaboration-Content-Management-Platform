<div align="center">

# TeamFlow CMS
### Enterprise collaboration & content platform — Jira/Confluence-style docs, reviews and repo-linked work

![React](https://img.shields.io/badge/React-TypeScript-61DAFB?logo=react&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-Express_5-339933?logo=nodedotjs&logoColor=white)
![Java](https://img.shields.io/badge/Java_21-Spring_Boot_3-6DB33F?logo=springboot&logoColor=white)
![Postgres](https://img.shields.io/badge/PostgreSQL_16-FTS_%2B_GIN-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-rate_limiting-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![NGINX](https://img.shields.io/badge/NGINX-gateway-009639?logo=nginx&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-EC2_·_RDS_·_ALB-FF9900?logo=amazonaws&logoColor=white)
![CI](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=githubactions&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-Grafana-E6522C?logo=prometheus&logoColor=white)

</div>

> **Not another CRUD app.** TeamFlow models how real internal engineering platforms work: *versioned content with optimistic concurrency, a review/approval state machine, signed + retried webhooks, a GitHub integration that links commits and PRs to documents, an append-only audit service in Java, and production-grade delivery with health-gated deploys and automatic rollback.*

---

## Table of contents
[Highlights](#highlights) · [Architecture](#architecture) · [Quick start](#quick-start) · [Feature deep-dive](#feature-deep-dive) · [API](#api-reference) · [RBAC](#rbac-matrix) · [Security](#security) · [Observability](#observability) · [CI/CD & AWS](#cicd--aws) · [Performance](#performance--how-to-measure-it) · [Engineering decisions](#engineering-decisions) · [Roadmap](#roadmap)

## Highlights

| Area | What's implemented |
|---|---|
| **Enterprise CMS** | Documents, immutable version history, restore-as-new-version, Markdown editor + sanitized live preview, `draft → in_review → approved → published` workflow, **PostgreSQL full-text search** (weighted `tsvector` + GIN, ranked, highlighted snippets) |
| **Collaboration** | Comments, `@mentions`, activity feed, document ownership, reviewer-based **approval workflow** bound to a specific version |
| **Security** | JWT auth, **OAuth2 (GitHub)**, **RBAC** (viewer / editor / admin) enforced server-side, bcrypt, AES-256-GCM encrypted integration tokens, HMAC-verified inbound webhooks, Helmet + CSP, **immutable audit log** |
| **Integration layer** | **GitHub integration** (connect repo → import commits/PRs → link to docs, auto-link via `DOC-xxxxxxxx`), inbound signed webhooks, **outbound webhooks** with HMAC signing, **exponential-backoff retries** and idempotency keys, **Idempotency-Key** support on writes, **Redis rate limiting** |
| **Frontend** | React 18 + TypeScript, responsive (mobile → desktop), dark mode, WCAG-minded (skip link, labels, `aria-live`, focus rings, keyboard-operable tabs), explicit loading/error/empty states, ES2019 build target for broad browser support |
| **Production engineering** | Multi-stage Docker builds, non-root containers, NGINX gateway (gzip, caching, security headers, rate limit), GitHub Actions CI + deploy, **health-gated deploys with automatic rollback**, graceful shutdown |
| **Observability** | Prometheus metrics (Node + Spring Actuator/Micrometer), Grafana dashboard provisioned as code, alert rules (availability, 5xx ratio, p95 latency, webhook failures), structured JSON logs with request-id correlation |

## Architecture

```mermaid
flowchart LR
  U[Browser<br/>React + TS SPA] -->|HTTPS| ALB[AWS ALB / TLS]
  ALB --> NGX[NGINX gateway<br/>static assets · gzip · rate limit · headers]
  NGX -->|/api| API[Node.js + Express API<br/>JWT · RBAC · REST]
  API --> PG[(PostgreSQL 16<br/>FTS + GIN)]
  API --> R[(Redis<br/>rate limiting)]
  API -->|X-Internal-Key| AUD[Java 21 / Spring Boot<br/>Audit service]
  AUD --> PG
  API -. outbox worker<br/>HMAC + retry .-> EXT[Customer webhooks]
  GH[GitHub] -->|signed webhooks| NGX
  API -->|REST + retry| GH
  PROM[Prometheus] -->|scrape /metrics| API
  PROM -->|scrape /actuator/prometheus| AUD
  GRAF[Grafana] --> PROM
```

**Why two backend runtimes?** The Node API owns the product surface (fast iteration, shared TypeScript types mindset), while the **Java service owns compliance-sensitive, append-only audit data** behind an internal key. It demonstrates polyglot service boundaries, internal auth, and cross-service failure isolation: audit writes are fire-and-forget with timeouts, so an audit outage never takes down the product.

```
teamflow-cms/
├── frontend/         React + TypeScript (Vite)
├── backend/          Node.js + Express API (TypeScript, vitest)
├── audit-service/    Java 21 + Spring Boot 3 audit service (JDBC, Actuator, Micrometer)
├── nginx/            Gateway config + Dockerfile that bundles the built SPA
├── db/init.sql       Schema, indexes, constraints
├── monitoring/       Prometheus, alert rules, Grafana dashboards-as-code
├── scripts/          deploy.sh (health-gated + rollback), k6 load test
├── docs/             AWS deployment guide
└── .github/workflows CI and Deploy pipelines
```

## Quick start

```bash
git clone <your-fork> && cd teamflow-cms
make up                      # builds + starts postgres, redis, audit, api, gateway, prometheus, grafana
make seed N=5000             # demo users + 5,000 documents (for search/load testing)
```

| Service | URL |
|---|---|
| App | http://localhost:8080 |
| Grafana | http://localhost:3001 (admin / `GRAFANA_PASSWORD`) → *TeamFlow — Service Overview* |
| Prometheus | http://localhost:9090 |

Demo logins (password `Passw0rd!`): `admin@teamflow.dev`, `editor@teamflow.dev`, `viewer@teamflow.dev`.

**Local dev without Docker for the apps:** `docker compose up -d postgres redis audit`, then `cd backend && npm i && npm run dev` and `cd frontend && npm i && npm run dev` (Vite proxies `/api` to `:4000`).

## Feature deep-dive

### 1. Enterprise CMS
- **Versioning:** every save inserts an immutable row in `document_versions`. *Restore* never rewrites history — it creates a new version with a "Restored from vN" note.
- **Optimistic concurrency:** `PUT` requires `baseVersion`; a stale editor gets `409 version_conflict` instead of silently overwriting a colleague.
- **Search:** a stored generated `tsvector` (title weight **A**, body weight **B**) with a GIN index; `websearch_to_tsquery` supports quoted phrases and `-exclusions`; results ranked with `ts_rank` and highlighted with `ts_headline`.
- **Workflow:** `draft → in_review → approved → published`. Editing after approval drops the document back to `draft`, so unreviewed content can never ship under an old approval.

### 2. Collaboration
Comments parse `@handle` against email local-parts and persist `mentions`; every mutation emits an **activity** event that feeds the UI timeline *and* the outbound webhook outbox. Approvals are bound to a **version number** — approving v3 does not approve v4.

### 3. Enterprise security
JWT access tokens (issuer-checked, short TTL), GitHub OAuth2 authorization-code login, role checks in middleware (never trusting the UI), admin-only role management, and a Java-backed audit trail of logins, failures, role changes, publishes and integration changes. Production boot **refuses default secrets**.

### 4. REST integration layer
- **GitHub:** connect with a PAT (validated against the API, stored AES-256-GCM encrypted) → sync commits/PRs (retry w/ backoff on 429/5xx) → link to docs manually or by writing `DOC-1a2b3c4d` in a commit message/PR title. Real-time updates arrive via **HMAC-verified (`X-Hub-Signature-256`) webhooks** with idempotent upserts, so redeliveries are safe.
- **Outbound webhooks:** transactional-outbox style table + polling worker using `FOR UPDATE SKIP LOCKED` leases (safe with multiple API replicas), 5 attempts with exponential backoff (10 s → 80 s), `X-TeamFlow-Signature` (HMAC-SHA256) and `X-TeamFlow-Delivery` idempotency key for receivers.
- **Idempotent writes:** send `Idempotency-Key` on `POST /documents` and retries replay the stored response (`Idempotent-Replay: true`).
- **Rate limiting:** Redis fixed-window limiter (fails open) plus NGINX `limit_req` at the edge.

### 5. Frontend
React + TypeScript SPA with typed API client, auth context, debounced search, DOMPurify-sanitized Markdown, responsive CSS grid, `prefers-color-scheme` and `prefers-reduced-motion` support, and semantic landmarks/labels throughout.

### 6. Production engineering
Multi-stage images, non-root users, container `HEALTHCHECK`s, `restart: unless-stopped`, SIGTERM-aware shutdown, `/healthz` (liveness) vs `/readyz` (DB/Redis readiness). **`scripts/deploy.sh`** pulls the new tag, restarts, polls health, and **rolls back automatically** to the last healthy tag on failure.

### 7. Observability
Prometheus histogram `http_request_duration_seconds{method,route,status}` (route templates, not raw URLs → bounded cardinality), `webhook_deliveries_total`, Node default metrics, plus JVM/HTTP metrics from the Java service. Grafana panels: availability, request rate, p95 (global + per route), 5xx ratio, webhook outcomes. Structured pino logs carry a request id propagated from NGINX (`X-Request-Id`).

## API reference

All routes are under `/api`; JWT `Authorization: Bearer <token>` unless noted.

| Method & path | Role | Purpose |
|---|---|---|
| `POST /auth/register` · `POST /auth/login` · `GET /auth/github` | public | Auth (register creates `viewer`) |
| `GET /auth/me` · `GET /users` · `PATCH /users/:id/role` | any · editor · admin | Identity & role admin |
| `GET /documents?q=&status=&limit=&offset=` | viewer* | List / full-text search (*viewers see published only) |
| `POST /documents` | editor | Create (supports `Idempotency-Key`) |
| `PUT /documents/:id` | owner/admin | New version (`baseVersion` required) |
| `GET /documents/:id/versions` · `POST …/versions/:v/restore` | viewer · owner | History / restore |
| `POST /documents/:id/submit` · `/publish` · `DELETE /documents/:id` | owner · owner (approved) · admin | Workflow |
| `GET/POST /documents/:id/comments` | viewer · editor | Comments + mentions |
| `GET/POST /documents/:id/approvals` · `POST /approvals/:id/decision` | viewer · owner · reviewer | Approvals |
| `GET /activity` | viewer | Activity feed |
| `POST /integrations/github` · `GET /integrations` · `POST /integrations/:id/sync` · `GET /integrations/:id/events` | editor | GitHub integration |
| `GET/POST /documents/:id/links` · `DELETE …/links/:eventId` | viewer · editor | Link commits/PRs to docs |
| `POST /hooks/github/:integrationId` | HMAC | Inbound GitHub webhook |
| `GET/POST/DELETE /webhook-endpoints` · `GET …/deliveries` | admin | Outbound webhooks |
| `GET /audit` | admin | Audit trail (proxied from Java service) |
| `GET /health` · `GET /healthz` · `GET /readyz` · `GET /metrics` | public/internal | Probes & Prometheus |

## RBAC matrix

| Capability | Viewer | Editor | Admin |
|---|:--:|:--:|:--:|
| Read published docs | ✅ | ✅ | ✅ |
| Read drafts / in-review | ❌ | ✅ | ✅ |
| Create docs, comment | ❌ | ✅ | ✅ |
| Edit / submit / publish **own** docs | ❌ | ✅ | ✅ (any) |
| Approve (as assigned reviewer) | ❌ | ✅ | ✅ (any) |
| Connect GitHub / sync | ❌ | ✅ | ✅ |
| Manage roles, webhooks, view audit, delete | ❌ | ❌ | ✅ |

## Security
- Passwords: bcrypt. Tokens: signed JWT with issuer + expiry. Secrets validated at boot in production.
- Integration tokens never stored in plaintext (AES-256-GCM, random IV, auth tag verified).
- Inbound webhooks authenticated with constant-time HMAC comparison; outbound webhooks signed the same way.
- Input validated with **zod** on every write; parameterized SQL everywhere; UUIDs validated before queries.
- Markdown rendered through **DOMPurify**; search snippets HTML-escaped before highlight injection; CSP + security headers at NGINX and Helmet.
- `/metrics` and the audit service are not routed publicly. Audit service requires an internal key (constant-time compare).
- **Known trade-offs (see roadmap):** JWT in `localStorage` (httpOnly cookies + CSRF would be stronger), no refresh-token rotation, outbound webhook URLs are not SSRF-filtered beyond scheme.

## Observability
```
http_request_duration_seconds_bucket{method,route,status}   → p50/p95/p99, request rate, 5xx ratio
webhook_deliveries_total{result}                             → integration health
up{job="api"}                                                → availability
```
Alert rules ship in `monitoring/alerts.yml`: `ApiDown`, `HighErrorRate` (>2 % 5xx), `HighLatencyP95` (>200 ms), `WebhookFailures`.

## CI/CD & AWS
- **CI** (`ci.yml`): backend typecheck + unit tests + build; frontend typecheck + build; Java `mvn verify`; then a **full-stack Docker smoke test** (boot → login → create doc → full-text search assertion).
- **CD** (`deploy.yml`): on green CI, build & push images tagged by commit SHA to GHCR, SSH to EC2 and run `deploy.sh <sha>` — **health-gated with automatic rollback**.
- **AWS reference topology** (`docs/DEPLOY_AWS.md`): ALB (TLS) → EC2 (Docker Compose) → RDS PostgreSQL (Multi-AZ) + ElastiCache Redis; secrets via SSM/Secrets Manager.

## Performance — how to measure it
A k6 script (`scripts/loadtest.js`) ramps to **500 virtual users** against search + list endpoints with thresholds `p(95) < 200ms` and `error rate < 1%`.

```bash
make up && make seed N=5000 && make loadtest
```
Then read results from k6 and the Grafana p95 panel. **Publish your own measured numbers** (hardware, dataset size, p95, error rate) in a `BENCHMARKS.md`; availability figures should come from a real uptime window, not a single load test.

## Engineering decisions
| Decision | Rationale |
|---|---|
| Postgres FTS instead of Elasticsearch | One less moving part; GIN + ranked `tsvector` is plenty for 10⁴–10⁵ docs; clear migration path to OpenSearch |
| Outbox table + `SKIP LOCKED` worker | At-least-once delivery without a broker; safe with N replicas |
| Version-bound approvals | Prevents "approved v2, published v5" compliance gaps |
| Optimistic concurrency (`baseVersion`) | Cheap, stateless protection against lost updates |
| Separate Java audit service | Isolates append-only compliance data; demonstrates internal service auth and polyglot ops |
| Route-template metric labels | Avoids Prometheus cardinality explosions from UUID paths |

## Roadmap
Refresh-token rotation + httpOnly cookies · real-time collaborative editing (CRDT/WebSocket) · rich-text (TipTap) editor · Bitbucket provider behind the same integration interface · Terraform for the AWS stack · OpenTelemetry tracing across Node ↔ Java · SSRF allow-listing for webhooks · Playwright E2E suite.

## License
MIT








<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0b5d56,100:1b2430&height=210&section=header&text=TeamFlow%20CMS&fontColor=ffffff&fontSize=64&fontAlignY=38&desc=Enterprise%20Collaboration%20%26%20Content%20Platform&descAlignY=60&descSize=20" alt="TeamFlow CMS" width="100%"/>

**Versioned documents · review & approval workflows · GitHub-linked work · signed webhooks · audited, observable, deployable**

<p>
  <img src="https://img.shields.io/badge/status-portfolio%20project-0b5d56?style=for-the-badge" alt="status"/>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="license"/>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs welcome"/>
  <img src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white" alt="CI"/>
</p>

<p>
  <a href="#-architecture">Architecture</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-api-reference">API</a> ·
  <a href="#-security">Security</a> ·
  <a href="#-observability">Observability</a> ·
  <a href="#-cicd--aws">CI/CD & AWS</a> ·
  <a href="#-performance">Performance</a>
</p>

</div>

---

## 🧰 Tech Stack

<div align="center">

### Frontend
<img src="https://skillicons.dev/icons?i=react,ts,vite,html,css&perline=10" alt="Frontend stack"/>

`React 18` · `TypeScript` · `Vite` · `React Router` · `marked + DOMPurify` · responsive CSS · dark mode

### Backend
<img src="https://skillicons.dev/icons?i=nodejs,express,ts,java,spring,maven&perline=10" alt="Backend stack"/>

`Node.js 20` · `Express 5` · `TypeScript` · `Zod` · `Pino` · `Java 21` · `Spring Boot 3` · `Micrometer` · `Maven`

### Data & Messaging
<img src="https://skillicons.dev/icons?i=postgres,redis&perline=10" alt="Data stack"/>

`PostgreSQL 16` (full-text search · GIN · JSONB · `SKIP LOCKED` queues) · `Redis 7` (rate limiting)

### Cloud, Infrastructure & DevOps
<img src="https://skillicons.dev/icons?i=aws,docker,nginx,githubactions,git,github,linux,bash&perline=10" alt="DevOps stack"/>

`AWS (EC2 · RDS · ElastiCache · ALB · ACM · SSM)` · `Docker & Compose` · `NGINX` · `GitHub Actions` · `GHCR`

### Observability & Testing
<img src="https://skillicons.dev/icons?i=prometheus,grafana,vitest&perline=10" alt="Observability stack"/>

`Prometheus` · `Grafana` · `Alertmanager-ready rules` · `Structured JSON logs` · `Vitest` · `JUnit 5` · `k6`

### Security & Integrations
<p>
<img src="https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white" alt="JWT"/>
<img src="https://img.shields.io/badge/OAuth2-EB5424?style=flat-square&logo=auth0&logoColor=white" alt="OAuth2"/>
<img src="https://img.shields.io/badge/GitHub%20REST%20API-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub API"/>
<img src="https://img.shields.io/badge/Webhooks-HMAC--SHA256-0b5d56?style=flat-square" alt="Webhooks"/>
<img src="https://img.shields.io/badge/AES--256--GCM-encrypted%20secrets-critical?style=flat-square" alt="AES"/>
<img src="https://img.shields.io/badge/RBAC-viewer%20%7C%20editor%20%7C%20admin-5C2D91?style=flat-square" alt="RBAC"/>
<img src="https://img.shields.io/badge/bcrypt-passwords-333?style=flat-square" alt="bcrypt"/>
<img src="https://img.shields.io/badge/Helmet-CSP-black?style=flat-square" alt="Helmet"/>
<img src="https://img.shields.io/badge/k6-load%20testing-7D64FF?style=flat-square&logo=k6&logoColor=white" alt="k6"/>
</p>

</div>

---

## 🎯 Why this project exists

Most portfolio apps stop at *login → create → edit → delete*. **TeamFlow** is built around the problems real internal engineering platforms have to solve:

- **Who changed what, and can I trust it?** → immutable version history, optimistic concurrency, version-bound approvals, append-only audit log.
- **How do docs connect to the code?** → GitHub integration that imports commits/PRs and links them to documents (manually or via `DOC-xxxxxxxx` references).
- **How do other systems react?** → HMAC-signed outbound webhooks with retries and idempotency keys.
- **Can I run it in production?** → health-gated deploys with automatic rollback, metrics, dashboards and alerts.

## 🏗 Architecture

```mermaid
flowchart LR
  U["🌐 Browser<br/>React + TypeScript SPA"] -->|HTTPS| ALB["AWS ALB · TLS (ACM)"]
  ALB --> NGX["NGINX gateway<br/>static assets · gzip · rate limit · security headers"]
  NGX -->|"/api"| API["Node.js + Express API<br/>JWT · RBAC · REST · zod"]
  API --> PG[("PostgreSQL 16<br/>FTS + GIN")]
  API --> R[("Redis<br/>rate limiting")]
  API -->|"X-Internal-Key"| AUD["☕ Java 21 · Spring Boot<br/>Audit service"]
  AUD --> PG
  API -. "outbox worker<br/>HMAC · retry · backoff" .-> EXT["Customer webhooks"]
  GH["GitHub"] -->|"signed webhooks"| NGX
  API -->|"REST + retry"| GH
  PROM["Prometheus"] -->|"/metrics"| API
  PROM -->|"/actuator/prometheus"| AUD
  GRAF["Grafana"] --> PROM
```

### Document lifecycle (state machine)

```mermaid
stateDiagram-v2
  [*] --> draft: create
  draft --> in_review: submit / request approval
  in_review --> approved: reviewer approves (same version)
  in_review --> draft: reviewer rejects
  approved --> published: owner publishes
  approved --> draft: edit (new version invalidates approval)
  published --> draft: edit
```

### GitHub integration flow

```mermaid
sequenceDiagram
  participant E as Editor
  participant API as TeamFlow API
  participant GH as GitHub
  participant DB as PostgreSQL
  E->>API: POST /integrations/github {repo, token}
  API->>GH: GET /repos/{repo} (validate)
  API->>DB: store AES-256-GCM(token) + webhook secret
  API-->>E: webhook URL + secret (shown once)
  E->>API: POST /integrations/:id/sync
  API->>GH: commits + PRs (retry w/ backoff)
  API->>DB: idempotent upsert + auto-link "DOC-xxxxxxxx"
  GH-)API: push / pull_request webhook (X-Hub-Signature-256)
  API->>API: constant-time HMAC verify
  API->>DB: upsert event (redelivery-safe)
```

### Data model

```mermaid
erDiagram
  users ||--o{ documents : owns
  documents ||--|{ document_versions : "immutable history"
  documents ||--o{ comments : has
  comments ||--o{ mentions : tags
  documents ||--o{ approvals : "bound to version"
  documents ||--o{ document_links : links
  integrations ||--o{ repo_events : imports
  repo_events ||--o{ document_links : "linked by"
  webhook_endpoints ||--o{ webhook_deliveries : "outbox + retries"
  users ||--o{ activity : performs
```

## ✨ Features

<table>
<tr><td width="50%" valign="top">

### 📝 Enterprise CMS
- Immutable **version history**; restore creates a *new* version
- **Optimistic concurrency** (`baseVersion` → `409` on stale edits)
- Markdown editor + sanitized live preview
- `draft → in_review → approved → published`
- **Full-text search**: weighted `tsvector`, GIN index, `websearch_to_tsquery`, ranked results, highlighted snippets

</td><td width="50%" valign="top">

### 🤝 Collaboration
- Comments with **@mentions**
- Real-time-style **activity feed**
- Document **ownership** rules
- Reviewer-based **approvals bound to a version**
- Every mutation emits events to the UI feed *and* the webhook outbox

</td></tr>
<tr><td valign="top">

### 🔐 Enterprise security
- **JWT** + **OAuth2 (GitHub)** sign-in
- **RBAC** enforced server-side (viewer / editor / admin)
- **Audit log** in a dedicated Java service
- AES-256-GCM encrypted integration tokens
- Boot-time refusal of default secrets in production

</td><td valign="top">

### 🔌 REST integration layer
- **GitHub**: connect → import commits/PRs → link to docs → live webhook updates
- **Outbound webhooks**: HMAC-signed, 5 attempts, exponential backoff, delivery IDs
- `Idempotency-Key` replay on writes
- **Redis rate limiting** + NGINX `limit_req`

</td></tr>
<tr><td valign="top">

### 🖥 Frontend
- React 18 + TypeScript, typed API client
- Responsive (mobile → desktop), **dark mode**
- Accessible: skip link, labelled controls, `aria-live`, focus rings, `prefers-reduced-motion`
- Explicit **loading / error / empty** states
- ES2019 build target for broad browser support

</td><td valign="top">

### 🚀 Production engineering
- Multi-stage, **non-root** Docker images + `HEALTHCHECK`s
- NGINX: gzip, immutable asset caching, CSP & security headers
- **Health-gated deploys with automatic rollback**
- Graceful shutdown, liveness vs readiness probes

</td></tr>
</table>

## ⚡ Quick Start

**Prerequisites:** Docker 24+ with Compose v2 (and `make`). Optional: Node 20, JDK 21, k6.

```bash
git clone https://github.com/<you>/teamflow-cms.git && cd teamflow-cms
make up              # postgres · redis · audit (Java) · api (Node) · gateway (NGINX + SPA) · prometheus · grafana
make seed N=5000     # demo users + 5,000 documents
```

| Service | URL | Notes |
|---|---|---|
| **App** | http://localhost:8080 | `editor@teamflow.dev` / `Passw0rd!` (also `admin@…`, `viewer@…`) |
| **Grafana** | http://localhost:3001 | dashboard *TeamFlow — Service Overview* |
| **Prometheus** | http://localhost:9090 | alert rules loaded from `monitoring/alerts.yml` |

<details>
<summary><b>Run apps locally without Docker</b></summary>

```bash
docker compose up -d postgres redis audit
cd backend  && npm install && npm run dev      # http://localhost:4000
cd frontend && npm install && npm run dev      # http://localhost:5173 (proxies /api)
```
</details>

<details>
<summary><b>Environment variables</b></summary>

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs access tokens (required in production) |
| `ENCRYPTION_KEY` | 64-hex-char key for AES-256-GCM (`openssl rand -hex 32`) |
| `AUDIT_API_KEY` | Shared key between API and Java audit service |
| `POSTGRES_PASSWORD` | Database password |
| `APP_URL` | Public base URL (CORS, OAuth redirect, webhook URLs) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional GitHub OAuth2 login |
</details>

## 📚 API Reference

All routes live under `/api`; authenticated routes need `Authorization: Bearer <JWT>`.

| Method & path | Min role | Purpose |
|---|---|---|
| `POST /auth/register` · `POST /auth/login` · `GET /auth/github` | public | Authentication (register → `viewer`) |
| `GET /auth/me` · `GET /users` · `PATCH /users/:id/role` | any · editor · admin | Identity & role admin |
| `GET /documents?q=&status=&limit=&offset=` | viewer¹ | List / full-text search |
| `POST /documents` | editor | Create (supports `Idempotency-Key`) |
| `PUT /documents/:id` | owner/admin | Save new version (`baseVersion`) |
| `GET /documents/:id/versions` · `POST …/versions/:v/restore` | viewer · owner | History / restore |
| `POST /documents/:id/submit` · `…/publish` · `DELETE /documents/:id` | owner · owner (approved) · admin | Workflow |
| `GET/POST /documents/:id/comments` | viewer · editor | Comments + mentions |
| `GET/POST /documents/:id/approvals` · `POST /approvals/:id/decision` | viewer · owner · reviewer | Approvals |
| `GET /activity` | viewer | Activity feed |
| `POST /integrations/github` · `GET /integrations` · `POST /integrations/:id/sync` · `GET …/events` | editor | GitHub integration |
| `GET/POST /documents/:id/links` · `DELETE …/links/:eventId` | viewer · editor | Link commits/PRs to docs |
| `POST /hooks/github/:id` | HMAC | Inbound GitHub webhook |
| `GET/POST/DELETE /webhook-endpoints` · `GET …/deliveries` | admin | Outbound webhooks |
| `GET /audit` | admin | Audit trail (from Java service) |
| `GET /health` · `/healthz` · `/readyz` · `/metrics` | public / internal | Probes & Prometheus |

¹ Viewers only see `published` documents.

## 🔒 Security

| Layer | Control |
|---|---|
| **AuthN** | bcrypt password hashing · short-lived JWT (issuer-checked) · GitHub OAuth2 code flow |
| **AuthZ** | Role middleware on every route · ownership checks · version-bound approvals |
| **Secrets** | Integration tokens encrypted with AES-256-GCM · production refuses default secrets |
| **Webhooks** | Inbound `X-Hub-Signature-256` verified in constant time · outbound signed `X-TeamFlow-Signature` |
| **Input** | Zod validation on writes · parameterized SQL · UUID validation · DOMPurify for rendered Markdown |
| **Edge** | NGINX rate limiting, CSP, `X-Frame-Options`, `nosniff`; `/metrics` and audit service never public |
| **Accountability** | Append-only audit log: logins, failures, role changes, publishes, integration changes |

> **Known trade-offs:** JWT is kept in `localStorage` (httpOnly cookies + CSRF would be stronger), no refresh-token rotation yet, and outbound webhook URLs are only scheme-validated (no SSRF allow-list). See [Roadmap](#-roadmap).

## 📈 Observability

```text
http_request_duration_seconds{method,route,status}   → request rate · p50/p95/p99 · 5xx ratio
webhook_deliveries_total{result}                      → integration health
up{job="api"}                                         → availability
```

- **Grafana dashboard as code:** availability, throughput, p95 (global & per route), error ratio, webhook outcomes.
- **Alert rules:** `ApiDown`, `HighErrorRate (>2%)`, `HighLatencyP95 (>200ms)`, `WebhookFailures`.
- **Logs:** structured JSON (pino) with request IDs propagated from NGINX (`X-Request-Id`).
- **Java service:** JVM + HTTP metrics via Spring Actuator / Micrometer.

## 🔁 CI/CD & AWS

```mermaid
flowchart LR
  A["git push"] --> B["CI"]
  B --> B1["Backend: typecheck · tests · build"]
  B --> B2["Frontend: typecheck · build"]
  B --> B3["Java: mvn verify"]
  B1 & B2 & B3 --> C["Docker smoke test<br/>login → create → search"]
  C --> D["Build & push images (GHCR, tag = SHA)"]
  D --> E["SSH → EC2: deploy.sh"]
  E --> F{"Health check<br/>passes?"}
  F -->|yes| G["✅ record last good tag"]
  F -->|no| H["⏪ automatic rollback"]
```

**AWS reference topology:** ALB (TLS via ACM) → EC2 running Docker Compose → RDS PostgreSQL (Multi-AZ) + ElastiCache Redis; secrets in SSM Parameter Store. Step-by-step guide: [`docs/DEPLOY_AWS.md`](docs/DEPLOY_AWS.md).

## 🏁 Performance

Load test: `scripts/loadtest.js` ramps to **500 virtual users** on search + list endpoints with thresholds `p(95) < 200ms` and `error rate < 1%`.

```bash
make up && make seed N=5000 && make loadtest
```

Record your own results here after running it:

| Dataset | Virtual users | p50 | p95 | p99 | Error rate | Hardware |
|---|---|---|---|---|---|---|
| _5,000 docs_ | _500_ | _…_ | _…_ | _…_ | _…_ | _e.g. t3.medium_ |

## 🗂 Repository layout

```text
teamflow-cms/
├── frontend/          React + TypeScript (Vite)
├── backend/           Node.js + Express API (TypeScript, Vitest)
├── audit-service/     Java 21 + Spring Boot 3 audit service
├── nginx/             Gateway config + Dockerfile (bundles built SPA)
├── db/init.sql        Schema, constraints, indexes
├── monitoring/        Prometheus, alert rules, Grafana provisioning
├── scripts/           deploy.sh (health-gated + rollback) · k6 load test
├── docs/              AWS deployment guide
└── .github/workflows  CI and Deploy pipelines
```

## 🧠 Engineering decisions

| Decision | Rationale |
|---|---|
| Postgres FTS over Elasticsearch | One fewer system to run; GIN + ranked `tsvector` covers 10⁴–10⁵ docs; clean path to OpenSearch later |
| Outbox table + `FOR UPDATE SKIP LOCKED` | At-least-once delivery without a broker; safe across multiple API replicas |
| Version-bound approvals | Prevents "approved v2, published v5" compliance gaps |
| Optimistic concurrency | Stateless protection against lost updates |
| Separate Java audit service | Isolates append-only compliance data; demonstrates internal service auth and polyglot operation; audit outages never block the product |
| Route-template metric labels | Bounds Prometheus cardinality (no UUIDs in labels) |

## 🛣 Roadmap

- [ ] httpOnly-cookie sessions + refresh-token rotation
- [ ] Real-time collaborative editing (WebSocket / CRDT)
- [ ] Rich-text editor (TipTap) alongside Markdown
- [ ] Bitbucket provider behind the same integration interface
- [ ] Terraform for the full AWS stack
- [ ] OpenTelemetry tracing across Node ↔ Java
- [ ] SSRF allow-listing for outbound webhooks
- [ ] Playwright end-to-end suite

## 🤝 Contributing

1. Fork and create a feature branch.
2. `cd backend && npm test` and `cd frontend && npm run typecheck`.
3. Open a PR; CI must be green.

## 📄 License

MIT — see [`LICENSE`](LICENSE).

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:1b2430,100:0b5d56&height=100&section=footer" width="100%" alt=""/>

</div>
