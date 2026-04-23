# Quick Start

## Local Startup

Review `docker-compose.example.yml`, then rename it to `docker-compose.yml` before the first startup.

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env
docker compose up --build
```

Sprinto starts at:

- `http://localhost:3000`

Default local profile:

- bundled PostgreSQL
- demo data enabled
- recovery admin enabled after you fill its password
