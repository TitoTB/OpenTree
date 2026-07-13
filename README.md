# OpenTree

OpenTree is an open source genealogy app for building, exploring and sharing a family tree.

## Deployment Model

OpenTree now targets a self-hosted container named `OpenTree`. The app is served by a small Node.js server and persists its data in `/data`, intended to be mounted as a Docker/Proxmox volume.

The application is designed to sit behind your own HTTPS layer, for example Cloudflare Tunnel.

## Access Profiles

OpenTree has two profiles:

- `admin`: can manage the tree, approve guest changes and access Ajustes.
- `guest`: can view the app and propose changes to people, relationships and gallery photos. Guest changes are queued until an admin approves them.

Initial passwords are created from environment variables:

- `OPENTREE_ADMIN_PASSWORD`
- `OPENTREE_GUEST_PASSWORD`

If they are not provided, the first startup uses:

- admin: `OpenTreeAdmin2026!`
- invitado: `OpenTreeInvitado2026!`

Change them from `Ajustes > Acceso web` after the first login.

## Docker Compose

```yaml
services:
  opentree:
    container_name: OpenTree
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      OPENTREE_ADMIN_PASSWORD: "OpenTreeAdmin2026!"
      OPENTREE_GUEST_PASSWORD: "OpenTreeInvitado2026!"
      OPENTREE_DATA_DIR: "/data"
      PORT: "8080"
    volumes:
      - opentree-data:/data

volumes:
  opentree-data:
```

## Local Development

```powershell
npm.cmd install
npm.cmd run dev
```

To test the production server locally:

```powershell
npm.cmd run build
npm.cmd run start
```

On Windows, if `OPENTREE_DATA_DIR` is not set, server data is stored in `.opentree-data/`. In Docker it uses `/data`.

## Release Workflow

Changes are accumulated in the repository. When a new version is explicitly requested, the release process should:

1. Build and verify the app.
2. Commit the accumulated changes.
3. Tag the release as `vX.Y.Z`.
4. Push the code and tag to GitHub.
5. Provide the Proxmox/Docker update commands.
