# Deploying TeamFlow on AWS

Reference topology: **1× EC2 (t3.medium) + RDS PostgreSQL + ElastiCache Redis**, fronted by an ALB with ACM TLS.
For a cheaper demo, run everything from `docker-compose.yml` on a single EC2 instance.

1. **Network** – VPC with public subnets (ALB) and private subnets (EC2, RDS, ElastiCache). Security groups: ALB→EC2:8080, EC2→RDS:5432, EC2→Redis:6379.
2. **Data** – RDS PostgreSQL 16 (Multi-AZ for the availability target). Run `db/init.sql` once. Point `DATABASE_URL` / `AUDIT_DB_URL` at RDS and remove the `postgres` service.
3. **Compute** – Amazon Linux 2023: `sudo dnf i docker git`, install the compose plugin, `git clone` this repo to `/opt/teamflow`, create `.env` from `.env.example` (use SSM Parameter Store / Secrets Manager for secrets in real deployments).
4. **Registry** – images are pushed to GHCR by `deploy.yml` (swap for ECR with `aws-actions/amazon-ecr-login`).
5. **CI/CD secrets** – `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` in the GitHub `production` environment.
6. **TLS & routing** – ALB listener 443 → target group on port 8080, health check path `/healthz`.
7. **Observability** – Prometheus/Grafana run on the same host (or use Amazon Managed Prometheus/Grafana). Never expose 9090/3001 publicly.
8. **Rollbacks** – `scripts/deploy.sh <tag>` records the last healthy tag and re-deploys it automatically if the new release fails its health check. Manual rollback: `./scripts/deploy.sh $(cat .last_good_tag)`.
