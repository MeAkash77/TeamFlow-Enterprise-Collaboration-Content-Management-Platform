.PHONY: up down seed logs test loadtest
up:        ## build and start the full stack
	cp -n .env.example .env || true
	docker compose up -d --build
seed:      ## seed demo users + N documents (default 5000)
	docker compose exec -T api sh -c "npm i --no-save tsx >/dev/null 2>&1; npx tsx src/seed.ts $${N:-5000}" || \
	(cd backend && DATABASE_URL=postgres://teamflow:teamflow@localhost:5432/teamflow npm run seed -- $${N:-5000})
down:
	docker compose down
logs:
	docker compose logs -f api audit
test:
	cd backend && npm test
loadtest:  ## requires k6
	k6 run -e BASE=http://localhost:8080 scripts/loadtest.js
