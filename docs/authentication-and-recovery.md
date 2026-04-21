# Authentication And Recovery

Sprinto supports:

- local sign-in
- Microsoft Active Directory sign-in
- Microsoft Entra sign-in
- a deployment-managed recovery admin

## Recovery Admin

Set these values in `.env`:

- `SPRINTO_RECOVERY_ADMIN_ENABLED=true`
- `SPRINTO_RECOVERY_ADMIN_USERNAME`
- `SPRINTO_RECOVERY_ADMIN_PASSWORD`
- `SPRINTO_RECOVERY_ADMIN_DISPLAY_NAME`
