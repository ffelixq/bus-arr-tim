# BusNow SG 🚌

A personal Singapore bus arrival dashboard with Google Maps integration.

## Features

- 📍 **GPS-based nearby stops** — finds your 8 nearest bus stops automatically
- 🗺 **Google Maps integration** — custom dark-theme map with stop markers
- 🔍 **Smart search** — search by stop code, stop name, road name, address, postal code, or coordinates
- ⏱ **Real-time arrivals** — next 3 buses per service with auto-refresh every 30 seconds
- 🗺 **Route on map** — tap any service to draw its full route as a green line
- 🚌 **Live bus positions** — shows actual GPS location of approaching buses on the map
- ⭐ **Favourites** — save stops for quick access (persisted locally)
- ♿ **Accessibility badges** — wheelchair-accessible bus indicators
- 🚍 **Bus type badges** — single deck, double deck, bendy bus
- 🎨 **Operator colour coding** — SBS (red), SMRT (blue), Tower Transit (purple), Go-Ahead (green)
- 🌙 **Dark theme** — easy on the eyes, day or night
- ⌨️ **Keyboard shortcut** — press `/` to focus the search bar

---

## Setup

### 1. Prerequisites

- [Node.js](https://nodejs.org) v18+
- A [Cloudflare account](https://cloudflare.com) (free tier is fine)
- An [LTA DataMall](https://datamall.lta.gov.sg) API key
- A [Google Cloud](https://console.cloud.google.com) project with Maps JavaScript API + Geocoding API enabled

### 2. Install dependencies

```bash
npm install
```

### 3. Configure your secrets in Cloudflare

You need two secrets. Set them via the Wrangler CLI:

```bash
# LTA DataMall API key (required)
npx wrangler secret put LTA_ACCOUNT_KEY
# Paste your LTA account key when prompted

# Google Maps API key (required)
npx wrangler secret put GOOGLE_MAPS_KEY
# Paste your Google Maps API key when prompted
```

> ⚠️ Do NOT add these as "build environment variables" in the Cloudflare dashboard.
> They must be **Worker Secrets** — set via CLI or via the dashboard under
> **Settings → Variables → Secret variables**.

### 4. Local development

Create a `.dev.vars` file in the project root:

```
LTA_ACCOUNT_KEY=your_lta_key_here
GOOGLE_MAPS_KEY=your_google_maps_key_here
```

Then run:

```bash
npm run dev
```

Open http://localhost:8787

### 5. Deploy

```bash
npm run deploy
```

Your site will be live at `https://busnow-sg.<your-subdomain>.workers.dev`

---

## Google Maps API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing)
3. Enable these APIs:
   - **Maps JavaScript API**
   - **Geocoding API**
4. Create an API key under **Credentials**
5. (Recommended) Restrict the key to your Worker domain

---

## LTA DataMall API Setup

1. Register at [DataMall](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html)
2. Request API access
3. You'll receive an `AccountKey` by email

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | The app frontend |
| `GET /api/arrivals?code=XXXXX` | Bus arrivals for a stop |
| `GET /api/stops` | All Singapore bus stops (cached 6h) |
| `GET /api/route?service=65&direction=1` | Full route for a service |

---

## Architecture

Everything runs in a single Cloudflare Worker:
- The Worker serves the frontend HTML/CSS/JS inline
- The Worker proxies all LTA API calls (keeping your key server-side)
- Bus stops data is cached in Worker memory for 6 hours
- The Google Maps key is injected into the HTML at serve time

No database, no KV store, no external services needed beyond the two APIs.
