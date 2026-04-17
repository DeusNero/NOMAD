<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="client/public/logo-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="client/public/logo-dark.svg" />
    <img src="client/public/logo-light.svg" alt="NOMAD" height="60" />
  </picture>
  <br />
  <em>Navigation Organizer for Maps, Activities & Destinations</em>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3" /></a>
  <a href="https://hub.docker.com/r/mauriceboe/nomad"><img src="https://img.shields.io/docker/pulls/mauriceboe/nomad" alt="Docker Pulls" /></a>
  <a href="https://github.com/mauriceboe/NOMAD"><img src="https://img.shields.io/github/stars/mauriceboe/NOMAD" alt="GitHub Stars" /></a>
  <a href="https://github.com/mauriceboe/NOMAD/commits"><img src="https://img.shields.io/github/last-commit/mauriceboe/NOMAD" alt="Last Commit" /></a>
</p>

<p align="center">
  A self-hosted, real-time collaborative travel planner with interactive maps, budgets, packing lists, and more.
  <br />
  <strong><a href="https://demo-nomad.pakulat.org">Live Demo</a></strong> — Try NOMAD without installing. Resets hourly.
</p>

![NOMAD Screenshot](docs/screenshot.png)
![NOMAD Screenshot 2](docs/screenshot-2.png)

<details>
<summary>More Screenshots</summary>

| | |
|---|---|
| ![Plan Detail](docs/screenshot-plan-detail.png) | ![Bookings](docs/screenshot-bookings.png) |
| ![Budget](docs/screenshot-budget.png) | ![Packing List](docs/screenshot-packing.png) |
| ![Files](docs/screenshot-files.png) | |

</details>

## Features

### Trip Planning
- **Drag & Drop Planner** — Organize places into day plans with reordering and cross-day moves
- **Interactive Map** — Leaflet map with photo markers, clustering, route visualization, and customizable tile sources
- **Place Search** — Search via Google Places (with photos, ratings, opening hours) or OpenStreetMap (free, no API key needed)
- **Day Notes** — Add timestamped, icon-tagged notes to individual days with drag & drop reordering
- **Route Optimization** — Auto-optimize place order and export to Google Maps
- **Weather Forecasts** — 16-day forecasts via Open-Meteo (no API key needed) with historical climate averages as fallback

### Travel Management
- **Reservations & Bookings** — Track flights, hotels, restaurants with status, confirmation numbers, and file attachments
- **Budget Tracking** — Category-based expenses with pie chart, per-person/per-day splitting, and multi-currency support
- **Packing Lists** — Categorized checklists with progress tracking, color coding, and smart suggestions
- **Document Manager** — Attach documents, tickets, and PDFs to trips, places, or reservations (up to 50 MB per file)
- **PDF Export** — Export complete trip plans as PDF with cover page, images, notes, and NOMAD branding

### Mobile
- **Responsive UI** — Works well in desktop and mobile browsers with touch-friendly controls and safe area handling
- **Home Screen Friendly** — Can still be pinned as a regular browser shortcut on phones and tablets
- **Shared Household Setup** — Trusted mode is designed for small private deployments without in-app login

### Collaboration
- **Real-Time Sync** — Plan together via WebSocket — changes appear instantly across all connected users
- **Multi-User** — Invite members to collaborate on shared trips with role-based access
- **Single Sign-On (OIDC)** — Login with Google, Apple, Authentik, Keycloak, or any OIDC provider
- **Collab** — Chat with your group, share notes, create polls, and track who's signed up for each day's activities

### Addons (modular, admin-toggleable)
- **Vacay** — Personal vacation day planner with calendar view, public holidays (100+ countries), company holidays, user fusion with live sync, and carry-over tracking
- **Atlas** — Interactive world map with visited countries, travel stats, continent breakdown, streak tracking, and liquid glass UI effects
- **Collab** — Chat with your group, share notes, create polls, and track who's signed up for each day's activities
- **Dashboard Widgets** — Currency converter and timezone clock, toggleable per user

### Customization & Admin
- **Dark Mode** — Full light and dark theme with dynamic status bar color matching
- **Multilingual** — English and German (i18n)
- **Admin Panel** — User management, global categories, addon management, API keys, backups, and GitHub release history
- **Auto-Backups** — Scheduled backups with configurable interval and retention
- **Customizable** — Temperature units, time format (12h/24h), map tile sources, default coordinates

## Tech Stack

- **Backend**: Node.js 22 + Express + SQLite (`better-sqlite3`)
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Client Delivery**: Standard Vite build served by the Node app or a reverse proxy
- **Real-Time**: WebSocket (`ws`)
- **State**: Zustand
- **Auth**: JWT + OIDC
- **Maps**: Leaflet + react-leaflet-cluster + Google Places API (optional)
- **Weather**: Open-Meteo API (free, no key required)
- **Icons**: lucide-react

## Quick Start

```bash
docker run -d -p 3000:3000 -v ./data:/app/data -v ./uploads:/app/uploads mauriceboe/nomad
```

The app runs on port `3000`.

For the default authenticated setup, first-run registration is locked down by default. Temporarily enable bootstrap registration, create your admin account, and then turn it back off:

```bash
docker run -d -p 3000:3000 \
  -e ALLOW_BOOTSTRAP_REGISTRATION=true \
  -v ./data:/app/data \
  -v ./uploads:/app/uploads \
  mauriceboe/nomad
```

After your first admin account exists, remove `ALLOW_BOOTSTRAP_REGISTRATION=true` on the next restart.

### Trusted Mode (no in-app login)

For private household setups you can run NOMAD without the login screen by enabling trusted mode:

```bash
docker run -d -p 3000:3000 \
  -e TRUSTED_MODE=true \
  -e TRUSTED_NAME="Household" \
  -v ./data:/app/data \
  -v ./uploads:/app/uploads \
  mauriceboe/nomad
```

Trusted mode automatically uses a single local admin account and disables login, registration, and OIDC flows inside the app.

> **Important:** Trusted mode is only safe on a private LAN or behind external access control such as Cloudflare Access or Tailscale. Do not expose a public domain directly with no outer authentication layer.

### Browser Shortcut

NOMAD is now delivered as a standard web app rather than a service-worker-backed PWA. If you want quicker access on mobile, create a normal browser shortcut:

1. Open your NOMAD instance in the browser
2. Use the browser's "Add to Home Screen" or "Create shortcut" option
3. Launch it from the shortcut like any other saved web app

<details>
<summary>Docker Compose (recommended for production)</summary>

```yaml
services:
  app:
    image: mauriceboe/nomad:latest
    container_name: nomad
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    restart: unless-stopped
```

```bash
docker compose up -d
```

</details>

### Updating

**Docker Compose** (recommended):

```bash
docker compose pull && docker compose up -d
```

**Docker Run** — use the same volume paths from your original `docker run` command:

```bash
docker pull mauriceboe/nomad
docker rm -f nomad
docker run -d --name nomad -p 3000:3000 -v ./data:/app/data -v ./uploads:/app/uploads --restart unless-stopped mauriceboe/nomad
```

> **Tip:** Not sure which paths you used? Run `docker inspect nomad --format '{{json .Mounts}}'` before removing the container.

Your data is persisted in the mounted `data` and `uploads` volumes — updates never touch your existing data.

### Reverse Proxy (recommended)

For production, put NOMAD behind a reverse proxy with HTTPS (e.g. Nginx, Caddy, Traefik).

> **Important:** NOMAD uses WebSockets for real-time sync. Your reverse proxy must support WebSocket upgrades on the `/ws` path.

<details>
<summary>Nginx</summary>

```nginx
server {
    listen 80;
    server_name nomad.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name nomad.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

</details>

<details>
<summary>Caddy</summary>

Caddy handles WebSocket upgrades automatically:

```
nomad.yourdomain.com {
    reverse_proxy localhost:3000
}
```

</details>

## Optional API Keys

API keys are configured in the **Admin Panel** after login. Keys set by the admin are automatically shared with all users — no per-user configuration needed.

### Google Maps (Place Search & Photos)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Places API (New)**
3. Create an API key under Credentials
4. In NOMAD: Admin Panel → Settings → Google Maps

## Building from Source

```bash
git clone https://github.com/mauriceboe/NOMAD.git
cd NOMAD
docker build -t nomad .
```

## Data & Backups

- **Database**: SQLite, stored in `./data/travel.db`
- **Uploads**: Stored in `./uploads/`
- **Backups**: Create and restore via Admin Panel
- **Auto-Backups**: Configurable schedule and retention in Admin Panel

## License

[AGPL-3.0](LICENSE)
