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

## Crear LXC automaticamente desde Proxmox

Desde la shell del host Proxmox:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/proxmox_create_lxc.sh)"
```

Opcionalmente puedes elegir parametros:

```bash
CTID=140 HOSTNAME=OpenTree MEMORY=2048 CORES=2 DISK=16 bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/proxmox_create_lxc.sh)"
```

Si tu almacenamiento no se llama `local-lvm`, indica otro:

```bash
ROOTFS_STORAGE=local bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/proxmox_create_lxc.sh)"
```

Despues abre:

```text
http://IP_DEL_CONTENEDOR:8080
```

## Instalacion en servidor Debian

En un LXC o VM Debian ya creado:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/install_debian.sh)"
```

## Actualizar un LXC existente desde Proxmox

Cuando haya una nueva version publicada en GitHub, no recrees el contenedor.
Ejecuta desde la shell del host Proxmox:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/proxmox_update_lxc.sh)"
```

Si necesitas indicar el ID manualmente:

```bash
CTID=140 bash -c "$(curl -fsSL https://raw.githubusercontent.com/TitoTB/OpenTree/main/scripts/proxmox_update_lxc.sh)"
```

## Docker Compose alternativo

Tambien se mantiene un `docker-compose.yml` para instalaciones Docker manuales.

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
