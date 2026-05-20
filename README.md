<img src="assets/docs/hero.svg" alt="Sprinto — Self-hosted planning poker" width="100%" />
<p align="center">
  <img src="assets/docs/divider.svg" width="100%" /><br/>
  <a href="https://github.com/AlienPixl/Sprinto/releases/latest">
    <img src="https://img.shields.io/github/v/release/AlienPixl/Sprinto?label=release&color=5EA8A0" alt="Latest release" />
  </a>
  &nbsp;
  <a href="https://github.com/AlienPixl/Sprinto/actions/workflows/release-tests.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/AlienPixl/Sprinto/release-tests.yml?label=tests&color=5EA8A0" alt="Tests" />
  </a>
  &nbsp;
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FAlienPixl%2FSprinto%2Fmain%2F.github%2Flicense-version.json&query=%24.version&label=license&prefix=Sprinto%20Custom%20&color=5EA8A0" alt="License" />
  </a>
  &nbsp;
  <a href="TRADEMARKS.md">
    <img src="https://img.shields.io/badge/trademarks-reserved-5EA8A0" alt="Trademarks" />
  </a>
  <img src="assets/docs/divider.svg" width="100%" />
</p>

Real-time planning poker that lives on your own server. Teams vote simultaneously — no anchoring, no waiting. Estimates go straight back to Jira with one click. Works with local accounts, Active Directory, and Microsoft Entra SSO out of the box.

- **Real-time voting** — simultaneous reveal, no anchoring bias
- **Jira Cloud** — import sprint backlog, push story points, post comments and PDF reports
- **Enterprise auth** — Active Directory LDAP and Microsoft Entra ID (OIDC) alongside local accounts
- **Vote history** — full timeline replay, scrub through who voted when
- **Role-based access** — built-in admin / master / user roles, fully customisable
- **Worklog reports** — Jira time-tracking aggregated by issue, user, or epic

<br>
<img src="assets/docs/integrations-banner.svg" alt="Jira Cloud and Microsoft Entra integration features" width="100%" />
<br>
<img src="assets/docs/divider.svg" width="100%" />

## What it looks like

<img src="assets/docs/screenshots/voting-admin.png" alt="Voting room — admin view" width="100%" />
<p align="center"><em>Voting room — admin view with live results and controls</em></p>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/voting-deck.png" alt="Participant view — card deck" width="100%" />
      <p><em>Participant view — card selection deck</em></p>
    </td>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/dashboard.png" alt="Dashboard — room list" width="100%" />
      <p><em>Dashboard — room list with status filters</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/auth-settings.png" alt="Authentication settings — local, Active Directory, Entra" width="100%" />
      <p><em>Authentication — local, Active Directory, and Entra ID side by side</em></p>
    </td>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/jira-settings.png" alt="Jira Cloud integration settings" width="100%" />
      <p><em>Jira Cloud — connect with a service account and API token</em></p>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/jira-import.gif" alt="Jira import — select board, sprint, apply JQL-like filters" width="100%" />
      <p><em>Jira import — select board, sprint, apply JQL-like filters</em></p>
    </td>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/voting-history.gif" alt="Vote history — scrub through the full timeline of who voted when" width="100%" />
      <p><em>Vote history — scrub through the full timeline of who voted when</em></p>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/voting-flow.gif" alt="Voting flow — cast votes, reveal simultaneously, push estimate to Jira" width="100%" />
      <p><em>Voting flow — cast votes, reveal simultaneously, push estimate to Jira</em></p>
    </td>
    <td width="50%" align="center">
      <img src="assets/docs/screenshots/worklog-report.gif" alt="Jira Worklog — time-tracking report grouped by issue, user, or epic" width="100%" />
      <p><em>Jira Worklog — time-tracking report grouped by issue, user, or epic</em></p>
    </td>
  </tr>
</table>

<img src="assets/docs/divider.svg" width="100%" />

## Quick start

**Requirements:** Docker Engine 24+ and Docker Compose v2.

```bash
cp default.env.example .env
# open .env and set SPRINTO_RECOVERY_ADMIN_PASSWORD
docker compose up -d
# → http://localhost:3000
```

<img src="assets/docs/divider.svg" width="100%" />

## Environment variables

### Core

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL connection string. The default `.env` points to the bundled service. |
| `PORT` | `3000` | Port the app listens on inside the container. |
| `SESSION_COOKIE_NAME` | `sprinto_session` | Cookie name. Change when running multiple instances on the same domain. |

### Bootstrap

| Variable | Default | Notes |
|---|---|---|
| `SPRINTO_SEED_DEMO_DATA` | `true` | Seed demo rooms and accounts (`admin/admin`, `master/master`, `user/user`) on first start. Set `false` for production. |
| `SPRINTO_RECOVERY_ADMIN_ENABLED` | `true` | Enable the break-glass admin account. |
| `SPRINTO_RECOVERY_ADMIN_USERNAME` | `sprinto-recovery` | Username for the break-glass account. |
| `SPRINTO_RECOVERY_ADMIN_PASSWORD` | — | **Set before first startup.** Store in a password manager. |
| `SPRINTO_RECOVERY_ADMIN_DISPLAY_NAME` | `System Recovery Admin` | Display name in UI and audit log. |

The recovery admin is recreated on every startup from these variables. To rotate the password — update `.env`, restart.

### Updates

| Variable | Default | Notes |
|---|---|---|
| `UPDATE_REPOSITORY` | `AlienPixl/Sprinto` | GitHub repo polled for new releases. Set to empty to disable (air-gapped environments). |

### Database TLS *(external PostgreSQL only)*

| Variable | Default | Notes |
|---|---|---|
| `SPRINTO_DB_SSL_ENABLED` | `false` | Enable TLS for the database connection. |
| `SPRINTO_DB_SSL_REJECT_UNAUTHORIZED` | `true` | Reject untrusted certificates. |
| `SPRINTO_DB_SSL_CA_FILE` | — | Path inside the container to a PEM CA certificate. |
| `SPRINTO_DB_SSL_CERT_FILE` | — | Client certificate for mutual TLS. |
| `SPRINTO_DB_SSL_KEY_FILE` | — | Client private key for mutual TLS. |

Mount certificates into the container and point the `*_FILE` variables to the mounted paths.

<img src="assets/docs/divider.svg" width="100%" />

## License & Branding

Source-available under a custom license. Internal use, inspection, and non-commercial sharing are permitted. Selling, monetising, or hosting as a paid service is not. Public forks must preserve attribution and use different branding.

[LICENSE](LICENSE) · [NOTICE](NOTICE) · [TRADEMARKS.md](TRADEMARKS.md)
