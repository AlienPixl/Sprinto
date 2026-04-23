<p align="center">
  <img src="assets/Logo_bitmap_noBG.png" alt="Sprinto logo" width="320" />
</p>

# Sprinto

Sprinto is a locally hosted planning poker application for team estimation.

## What Sprinto Does

- creates planning poker rooms
- supports voting and result reveal in real time
- manages issue queues and voting history
- includes administration for users, roles, card decks, and settings
- supports local sign-in, a deployment-managed recovery admin, `Microsoft Active Directory`, and `Microsoft Entra`

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Sprinto starts at:

- `http://localhost:3000`

The default local setup uses:

- bundled PostgreSQL and Sprinto run together in one Docker deployment
- demo data and demo users are enabled
- recovery admin can be enabled after you fill its password
- `DATABASE_URL` points to the bundled PostgreSQL service from `docker-compose.yml`

## Demo Accounts

When `SPRINTO_SEED_DEMO_DATA=true`, Sprinto creates:

- `admin / admin`
- `master / master`
- `user / user`

## Authentication

Sprinto supports:

- local sign-in
- Microsoft Active Directory sign-in
- Microsoft Entra sign-in
- a deployment-managed recovery admin

Recovery admin credentials are configured through `.env`:

- `SPRINTO_RECOVERY_ADMIN_USERNAME`
- `SPRINTO_RECOVERY_ADMIN_PASSWORD`
- `SPRINTO_RECOVERY_ADMIN_DISPLAY_NAME`

## Release Artifacts

Sprinto publishes versioned GitHub releases as `Sprinto vX.Y.Z`.

Each release ships:

- a Linux `amd64` Docker image tarball
- a release-ready Docker Compose file generated from the same `docker-compose.yml`
- release notes from `changelog/vX.Y.Z.md`

## Documentation

Public-facing documentation lives under `docs/`:

- [Docs Home](docs/README.md)
- [Quick Start](docs/quick-start.md)
- [Authentication And Recovery](docs/authentication-and-recovery.md)
- [Jira Integrations](docs/jira-integrations.md)
- [Releases](docs/releases.md)

## License & Branding

Sprinto is source-available under a custom license. You can use it internally, inspect
the source, make private changes, and share it on a non-commercial basis.

You may not sell Sprinto, monetize access to Sprinto, offer it as a paid hosted service,
or present Sprinto as your own original product.

If you share Sprinto or a public fork, you must preserve attribution to Martin Janecek.
Modified public forks must also use different branding unless you have prior written
permission.

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)
- [TRADEMARKS.md](TRADEMARKS.md)
