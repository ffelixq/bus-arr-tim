let _stopsCache = null;
let _stopsCacheAt = 0;
const STOPS_TTL = 6 * 3600 * 1000;

async function getAllStops(key) {
  if (_stopsCache && Date.now() - _stopsCacheAt < STOPS_TTL) return _stopsCache;

  const stops = [];
  let skip = 0;

  while (true) {
    const r = await fetch(
      `https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`,
      {
        headers: {
          AccountKey: key,
          accept: "application/json",
        },
      }
    );

    if (!r.ok) break;

    const d = await r.json();
    const batch = d.value || [];
    stops.push(...batch);

    if (batch.length < 500) break;
    skip += 500;
    if (skip > 6000) break;
  }

  _stopsCache = stops;
  _stopsCacheAt = Date.now();
  return stops;
}

async function getRoute(key, svc, dir) {
  const stops = [];
  let skip = 0;

  while (true) {
    const r = await fetch(
      `https://datamall2.mytransport.sg/ltaodataservice/BusRoutes?$filter=ServiceNo eq '${svc}' and Direction eq ${dir}&$skip=${skip}`,
      {
        headers: {
          AccountKey: key,
          accept: "application/json",
        },
      }
    );

    if (!r.ok) break;

    const d = await r.json();
    const batch = d.value || [];
    stops.push(...batch);

    if (batch.length < 500) break;
    skip += 500;
    if (skip > 3000) break;
  }

  return stops.sort((a, b) => a.StopSequence - b.StopSequence);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
    },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    try {
      if (path === "/" || path === "/index.html") {
        return new Response(buildHTML(env.GOOGLE_MAPS_KEY || ""), {
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      }

      if (!env.LTA_ACCOUNT_KEY) {
        return json({ error: "LTA_ACCOUNT_KEY not set in Worker secrets" }, 500);
      }

      if (path === "/api/arrivals") {
        const code = url.searchParams.get("code");
        if (!code) return json({ error: "Missing code" }, 400);

        const r = await fetch(
          `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${code}`,
          {
            headers: {
              AccountKey: env.LTA_ACCOUNT_KEY,
              accept: "application/json",
            },
          }
        );

        return json(await r.json(), r.status);
      }

      if (path === "/api/stops") {
        const stops = await getAllStops(env.LTA_ACCOUNT_KEY);
        return new Response(JSON.stringify(stops), {
          headers: {
            ...CORS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=21600",
          },
        });
      }

      if (path === "/api/route") {
        const svc = url.searchParams.get("service");
        const dir = parseInt(url.searchParams.get("direction") || "1", 10);

        if (!svc) return json({ error: "Missing service" }, 400);

        const [route, stops] = await Promise.all([
          getRoute(env.LTA_ACCOUNT_KEY, svc, dir),
          getAllStops(env.LTA_ACCOUNT_KEY),
        ]);

        const sm = {};
        stops.forEach((s) => {
          sm[s.BusStopCode] = s;
        });

        const result = route.map((r) => ({
          seq: r.StopSequence,
          code: r.BusStopCode,
          dist: r.Distance,
          name: sm[r.BusStopCode]?.Description || r.BusStopCode,
          road: sm[r.BusStopCode]?.RoadName || "",
          lat: sm[r.BusStopCode]?.Latitude || 0,
          lng: sm[r.BusStopCode]?.Longitude || 0,
          wdFirst: r.WD_FirstBus,
          wdLast: r.WD_LastBus,
          sabFirst: r.SAB_FirstBus,
          sabLast: r.SAB_LastBus,
          sunFirst: r.SUN_FirstBus,
          sunLast: r.SUN_LastBus,
        }));

        return json(result);
      }
    } catch (e) {
      return json({ error: e.message || "Unexpected server error" }, 500);
    }

    return new Response("Not Found", { status: 404 });
  },
};

function buildHTML(mapsKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>BusNow SG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
button{cursor:pointer;font-family:inherit}
:root{
  --bg:#0d1117;
  --surface:#161b22;
  --card:#1c2333;
  --card2:#212d3f;
  --border:rgba(255,255,255,0.08);
  --accent:#00d97e;
  --accent-glow:rgba(0,217,126,0.18);
  --text:#e6edf3;
  --muted:#8b949e;
  --amber:#f0a832;
  --red:#f85149;
  --blue:#58a6ff;
  --seated:#3fb950;
  --standing:#f0a832;
  --crowded:#f85149;
  --shadow:0 8px 32px rgba(0,0,0,0.55);
}
html,body{
  height:100%;
  width:100%;
  overflow:hidden;
  background:var(--bg);
  font-family:'Outfit',sans-serif;
  color:var(--text);
}
#map{
  position:fixed;
  top:0;
  left:0;
  width:100vw;
  height:100vh;
  z-index:1;
  background:#1a1a1a;
  border:2px solid #00d97e;
}
#map-fallback{
  position:fixed;
  inset:0;
  z-index:2;
  display:none;
  align-items:center;
  justify-content:center;
  background:#0d1117;
  color:#e6edf3;
  padding:24px;
  text-align:center;
}
.top-bar{
  position:fixed;top:0;left:0;right:0;z-index:100;
  padding:12px 14px 0;
  display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(to bottom,rgba(13,17,23,.97) 60%,transparent);
  pointer-events:none;
}
.top-row{display:flex;align-items:center;gap:10px;pointer-events:all}
.logo{
  font-size:17px;font-weight:700;letter-spacing:-.5px;
  white-space:nowrap;color:var(--text);flex-shrink:0
}
.logo span{color:var(--accent)}
.search-bar{
  flex:1;display:flex;align-items:center;
  background:var(--surface);border:1px solid var(--border);
  border-radius:10px;padding:0 11px;height:40px;
  pointer-events:all;
}
.search-bar input{
  flex:1;background:none;border:none;outline:none;
  color:var(--text);font:inherit;font-size:13.5px;padding:0 8px;
}
.search-bar input::placeholder{color:var(--muted)}
#qclr{
  background:none;border:none;color:var(--muted);
  font-size:18px;line-height:1;padding:0 2px;display:none
}
.icon-btn{
  width:40px;height:40px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;color:var(--text);
}
.bottom-sheet{
  position:fixed;bottom:0;left:0;right:0;z-index:90;
  background:var(--surface);border-radius:20px 20px 0 0;
  border-top:1px solid var(--border);
  box-shadow:0 -8px 32px rgba(0,0,0,.45);
  display:flex;flex-direction:column;
  max-height:62vh;
}
.sheet-handle-area{
  display:flex;justify-content:center;
  padding:12px 0 6px;cursor:pointer;flex-shrink:0
}
.handle-bar{width:36px;height:4px;background:var(--border);border-radius:2px}
.sheet-tabs{
  display:flex;padding:0 14px;
  border-bottom:1px solid var(--border);flex-shrink:0
}
.sheet-tab{
  padding:8px 14px;font:inherit;font-size:13px;font-weight:500;
  color:var(--muted);background:none;border:none;
  border-bottom:2px solid transparent;margin-bottom:-1px;
}
.sheet-tab.active{color:var(--text);border-color:var(--accent)}
.stops-list{flex:1;overflow-y:auto;padding:6px 0 24px}
.stop-card{
  display:flex;align-items:center;gap:12px;
  padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.04);
  cursor:pointer;
}
.sc-icon{
  width:42px;height:42px;border-radius:12px;background:var(--card2);
  display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0
}
.sc-info{flex:1;min-width:0}
.sc-name{font-size:15px;font-weight:600;line-height:1.2}
.sc-meta{
  margin-top:4px;font-size:12.5px;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis
}
.sc-code{
  display:inline-flex;align-items:center;justify-content:center;
  background:rgba(0,217,126,.12);color:var(--accent);
  border:1px solid rgba(0,217,126,.2);
  border-radius:999px;padding:2px 7px;margin-right:6px;
  font-family:'Space Mono',monospace;font-size:11px
}
.sc-right{text-align:right;flex-shrink:0}
.sc-dist{font-size:12.5px;font-weight:600}
.sc-walk{margin-top:3px;font-size:11.5px;color:var(--muted)}
.state-box{
  min-height:180px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;color:var(--muted);padding:18px
}
.spinner{
  width:28px;height:28px;border-radius:50%;
  border:2px solid rgba(255,255,255,.08);
  border-top-color:var(--accent);animation:spin .8s linear infinite
}
@keyframes spin{to{transform:rotate(360deg)}}
.stop-panel{
  position:fixed;left:0;right:0;bottom:0;z-index:130;
  background:var(--surface);
  border-radius:22px 22px 0 0;
  border-top:1px solid var(--border);
  box-shadow:var(--shadow);
  max-height:86vh;
  transform:translateY(100%);
  transition:transform .28s ease;
  display:flex;flex-direction:column;
}
.stop-panel.open{transform:translateY(0)}
.ph-top{
  display:flex;align-items:flex-start;gap:10px;
  padding:14px 16px 10px;border-bottom:1px solid var(--border)
}
.back-btn,.fav-btn{
  width:38px;height:38px;border-radius:10px;
  background:var(--card);border:1px solid var(--border);color:var(--text);
  display:flex;align-items:center;justify-content:center;flex-shrink:0
}
.ph-main{flex:1;min-width:0}
.ph-name{font-size:18px;font-weight:700;line-height:1.2}
.ph-meta{margin-top:4px;color:var(--muted);font-size:12.5px}
.ph-refresh{
  display:flex;align-items:center;gap:10px;
  padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.05)
}
.ref-wrap{flex:1}
.ref-text{font-size:11.5px;color:var(--muted);margin-bottom:6px}
.ref-track{width:100%;height:5px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden}
.ref-fill{
  width:100%;height:100%;
  background:linear-gradient(90deg,var(--accent),#00ffb3);
  border-radius:999px;
}
.ref-btn{
  font-size:12px;padding:7px 10px;border-radius:9px;
  background:var(--card);color:var(--text);border:1px solid var(--border)
}
.arrivals-scroll{
  flex:1;overflow-y:auto;padding:12px 14px 24px;
  display:flex;flex-direction:column;gap:12px
}
.svc-card{
  position:relative;background:linear-gradient(180deg,var(--card),#182133);
  border:1px solid rgba(255,255,255,.06);
  border-radius:16px;padding:14px 14px 12px;overflow:hidden;cursor:pointer
}
.op-stripe{
  position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--accent)
}
.op-SBST{background:#e8192c}
.op-SMRT{background:#0070b8}
.op-TOWT{background:#6f2c91}
.op-GAS{background:#009e6b}
.svc-hdr{display:flex;align-items:center;gap:10px}
.svc-num{
  font-size:28px;font-weight:700;line-height:1;
  font-family:'Space Mono',monospace;min-width:64px
}
.svc-dest{
  flex:1;color:var(--text);font-size:14px;font-weight:500;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis
}
.svc-next{
  font-size:16px;font-weight:700;padding:6px 10px;border-radius:999px;
  background:rgba(255,255,255,.06)
}
.bus-rows{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.bus-row{
  display:flex;align-items:center;gap:10px;
  padding:8px 10px;background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.04);border-radius:12px
}
.bseq{
  width:22px;height:22px;border-radius:50%;
  background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;flex-shrink:0
}
.btime{min-width:54px;font-size:14px;font-weight:700}
.btime.na{color:var(--muted)}
.badge,.load-pill{
  display:inline-flex;align-items:center;justify-content:center;
  height:22px;padding:0 8px;border-radius:999px;
  font-size:11px;font-weight:600;border:1px solid transparent
}
.load-pill{margin-left:auto}
.load-seated{background:rgba(63,185,80,.12);color:#3fb950;border-color:rgba(63,185,80,.25)}
.load-standing{background:rgba(240,168,50,.12);color:#f0a832;border-color:rgba(240,168,50,.25)}
.load-crowded{background:rgba(248,81,73,.12);color:#f85149;border-color:rgba(248,81,73,.25)}
.bbadges{display:flex;gap:6px}
.badge{background:rgba(255,255,255,.06);color:var(--text);border-color:rgba(255,255,255,.06)}
.route-panel{
  position:fixed;top:0;right:0;bottom:0;z-index:150;
  width:min(460px,100vw);
  background:rgba(13,17,23,.98);
  border-left:1px solid var(--border);
  transform:translateX(100%);
  transition:transform .26s ease;
  display:flex;flex-direction:column
}
.route-panel.open{transform:translateX(0)}
.rp-head{
  display:flex;align-items:flex-start;gap:10px;
  padding:16px;border-bottom:1px solid var(--border);flex-shrink:0
}
.rp-num{
  font-size:26px;font-weight:700;font-family:'Space Mono',monospace;line-height:1
}
.rp-meta{flex:1;min-width:0}
.rp-title{font-size:15px;font-weight:700}
.rp-sub{margin-top:4px;font-size:12px;color:var(--muted)}
.rp-close{
  width:38px;height:38px;border-radius:10px;background:var(--card);
  border:1px solid var(--border);color:var(--text)
}
.route-list{flex:1;overflow-y:auto;padding:6px 0 20px}
.rs-item{
  display:flex;gap:12px;padding:10px 16px;cursor:pointer;
}
.rs-item.cur{background:rgba(0,217,126,.08)}
.rs-line{width:20px;display:flex;flex-direction:column;align-items:center;flex-shrink:0}
.rs-dot{
  width:12px;height:12px;border-radius:50%;background:var(--accent);
  margin-top:3px
}
.rs-connector{width:2px;flex:1;background:rgba(255,255,255,.08);margin-top:4px}
.rs-text{flex:1;min-width:0}
.rs-name{font-size:14px;font-weight:600}
.rs-sub{
  margin-top:3px;font-size:12px;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis
}
.toast{
  position:fixed;left:50%;bottom:88px;transform:translateX(-50%) translateY(10px);
  z-index:170;
  background:rgba(22,27,34,.96);border:1px solid var(--border);
  color:var(--text);padding:11px 14px;border-radius:999px;
  font-size:12.5px;opacity:0;pointer-events:none;
  transition:all .22s ease;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.fav-active{color:#ffd54a;border-color:rgba(255,213,74,.35)}
@media (min-width:900px){
  .bottom-sheet{width:430px;left:16px;right:auto;bottom:16px;height:calc(100vh - 92px);max-height:none;border-radius:20px;border:1px solid var(--border)}
  .stop-panel{width:430px;left:16px;right:auto;bottom:16px;border-radius:20px;max-height:calc(100vh - 32px)}
  .route-panel{right:16px;top:16px;bottom:16px;height:auto;border:1px solid var(--border);border-radius:20px}
  .toast{bottom:28px}
}
</style>
</head>
<body>
<div id="map"></div>
<div id="map-fallback">
  <div>
    <div style="font-size:28px;margin-bottom:10px;">🗺️</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:8px;">Map failed to load</div>
    <div style="font-size:13px;color:#8b949e;">Check Console logs below.</div>
  </div>
</div>

<div class="top-bar">
  <div class="top-row">
    <div class="logo">Bus<span>Now</span> SG</div>

    <div class="search-bar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input id="q" placeholder="Search stop code, road, stop name, address, or lat lng">
      <button id="qclr" aria-label="Clear search">×</button>
    </div>

    <button class="icon-btn" id="locbtn" aria-label="Locate me">◎</button>
  </div>
</div>

<div class="bottom-sheet" id="bsheet">
  <div class="sheet-handle-area" id="shandle"><div class="handle-bar"></div></div>

  <div class="sheet-tabs">
    <button class="sheet-tab active" data-tab="nearby">Nearby</button>
    <button class="sheet-tab" data-tab="favorites">Favourites</button>
  </div>

  <div class="stops-list" id="stops-list">
    <div class="state-box">
      <div class="spinner"></div>
      <span>Loading nearby bus stops…</span>
    </div>
  </div>
</div>

<div class="stop-panel" id="spanel">
  <div class="ph-top">
    <button class="back-btn" id="backbtn" aria-label="Back">←</button>

    <div class="ph-main">
      <div class="ph-name" id="ph-name">Bus Stop</div>
      <div class="ph-meta">
        <span id="ph-code"></span><span id="ph-road"></span>
      </div>
    </div>

    <button class="fav-btn" id="favbtn" aria-label="Favourite">★</button>
  </div>

  <div class="ph-refresh">
    <div class="ref-wrap">
      <div class="ref-text" id="reftxt">Refreshing in 15s</div>
      <div class="ref-track"><div class="ref-fill" id="reffill"></div></div>
    </div>
    <button class="ref-btn" id="refnow">Refresh now</button>
  </div>

  <div class="arrivals-scroll" id="arr-list">
    <div class="state-box"><div class="spinner"></div></div>
  </div>
</div>

<div class="route-panel" id="rpanel">
  <div class="rp-head">
    <div><div class="rp-num" id="rp-num">174</div></div>
    <div class="rp-meta">
      <div class="rp-title" id="rp-title">Loading route…</div>
      <div class="rp-sub" id="rp-sub"></div>
    </div>
    <button class="rp-close" id="rpclose">✕</button>
  </div>
  <div class="route-list" id="route-list"></div>
</div>

<div class="toast" id="toast"></div>

<script>
const REFRESH = 15;

const S = {
  map: null,
  center: null,
  allStops: [],
  nearbyStops: [],
  markers: {},
  busMks: [],
  userMk: null,
  routeLine: null,
  stop: null,
  tab: "nearby",
  favs: new Set(JSON.parse(localStorage.getItem("bnsg_favs") || "[]")),
  loadingStops: false,
  timer: null,
  ticker: null,
  countdown: REFRESH,
  sheetCollapsed: false,
};

function toast(msg, d = 2600) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), d);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) {
  if (m < 1000) return Math.round(m) + " m";
  return (m / 1000).toFixed(1) + " km";
}

function fmtWalk(m) {
  const mins = Math.max(1, Math.round(m / 75));
  return mins + " min walk";
}

function getMin(iso) {
  if (!iso) return null;
  const m = (new Date(iso) - Date.now()) / 60000;
  return Math.max(0, Math.round(m));
}

function mc(m) {
  if (m === null) return "na";
  if (m <= 1) return "arriving";
  if (m <= 5) return "soon";
  return "normal";
}

function mt(m) {
  if (m === null) return "—";
  if (m === 0) return "Arr";
  return m + " min";
}

function fmtT(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function opColor(op) {
  const m = { SBST:"#e8192c", SMRT:"#0070b8", TOWT:"#6f2c91", GAS:"#009e6b" };
  return m[op] || "#00d97e";
}

function stopName(code) {
  const s = S.allStops.find((x) => x.BusStopCode === code);
  return s ? s.Description : code;
}

window.gm_authFailure = function () {
  console.error("Google Maps auth failure");
  document.getElementById("map-fallback").style.display = "flex";
};

window.initMap = function () {
  console.log("initMap called");
  try {
    S.map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: 1.3521, lng: 103.8198 },
      zoom: 15,
      mapTypeId: "roadmap",
      disableDefaultUI: true,
      gestureHandling: "greedy",
      clickableIcons: false,
    });

    toast("Map initialized");
    console.log("Map object created:", !!S.map);

    S.map.addListener("tilesloaded", () => {
      console.log("Map tiles loaded");
    });

    S.map.addListener("idle", () => {
      console.log("Map idle");
    });

    S.map.addListener("click", (e) => {
      if (!S.allStops.length) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      const nearest = S.allStops
        .map((s) => ({ ...s, d: haversine(lat, lng, s.Latitude, s.Longitude) }))
        .sort((a, b) => a.d - b.d)[0];

      if (nearest && nearest.d < 300) {
        openStop(nearest.BusStopCode);
      } else {
        setCenter(lat, lng, false);
        toast("Showing stops near this location");
      }
    });

    boot();
  } catch (err) {
    console.error("initMap failed:", err);
    document.getElementById("map-fallback").style.display = "flex";
  }
};

async function boot() {
  loadAllStops();
  requestLoc();
}

async function loadAllStops() {
  if (S.loadingStops) return;
  S.loadingStops = true;

  try {
    const r = await fetch("/api/stops");
    S.allStops = await r.json();

    if (S.center) updateNearby(S.center.lat, S.center.lng);
  } catch (e) {
    toast("⚠ Could not load stops data");
  }

  S.loadingStops = false;
}

function requestLoc() {
  if (!navigator.geolocation) {
    defaultCenter();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (p) => {
      setCenter(p.coords.latitude, p.coords.longitude, true);
    },
    () => {
      defaultCenter();
    },
    { timeout: 12000, maximumAge: 30000 }
  );
}

function defaultCenter() {
  setCenter(1.3521, 103.8198, false);
  toast("Enable GPS for accurate nearby stops");
}

function setCenter(lat, lng, isUser) {
  S.center = { lat, lng };

  if (!S.map) return;

  S.map.setCenter({ lat, lng });
  S.map.setZoom(16);

  if (isUser) {
    if (S.userMk) S.userMk.setMap(null);
    S.userMk = new google.maps.Marker({
      position: { lat, lng },
      map: S.map,
      zIndex: 100,
    });
  }

  if (S.allStops.length) updateNearby(lat, lng);
}

function updateNearby(lat, lng) {
  const wd = S.allStops
    .map((s) => ({ ...s, d: haversine(lat, lng, s.Latitude, s.Longitude) }))
    .sort((a, b) => a.d - b.d);

  S.nearbyStops = wd.slice(0, 8);
  renderList();
  updateMarkers();
}

function updateMarkers() {
  if (!S.map) return;

  Object.values(S.markers).forEach((m) => m.setMap(null));
  S.markers = {};

  const stops = getListStops();

  stops.forEach((stop) => {
    if (!stop.Latitude) return;

    const sel = S.stop?.BusStopCode === stop.BusStopCode;

    const m = new google.maps.Marker({
      position: { lat: stop.Latitude, lng: stop.Longitude },
      map: S.map,
      title: stop.Description,
      zIndex: sel ? 10 : 5,
    });

    m.addListener("click", () => openStop(stop.BusStopCode));
    S.markers[stop.BusStopCode] = m;
  });
}

function getListStops() {
  if (S.tab === "favorites") {
    return S.allStops
      .filter((s) => S.favs.has(s.BusStopCode))
      .map((s) => ({
        ...s,
        d: S.center ? haversine(S.center.lat, S.center.lng, s.Latitude, s.Longitude) : 0,
      }))
      .sort((a, b) => a.d - b.d);
  }

  return S.nearbyStops;
}

function renderList() {
  const el = document.getElementById("stops-list");
  const stops = getListStops();

  if (!S.allStops.length) {
    el.innerHTML = '<div class="state-box"><div class="spinner"></div><span>Loading stops…</span></div>';
    return;
  }

  if (!stops.length) {
    el.innerHTML = '<div class="state-box"><div>No stops found</div></div>';
    return;
  }

  el.innerHTML = stops.map((s) => {
    return '<div class="stop-card" data-stop-code="' + s.BusStopCode + '">' +
      '<div class="sc-icon">🚏</div>' +
      '<div class="sc-info">' +
        '<div class="sc-name">' + s.Description + '</div>' +
        '<div class="sc-meta"><span class="sc-code">' + s.BusStopCode + '</span>' + s.RoadName + '</div>' +
      '</div>' +
      (s.d != null
        ? '<div class="sc-right"><div class="sc-dist">' + fmtDist(s.d) + '</div><div class="sc-walk">' + fmtWalk(s.d) + '</div></div>'
        : '') +
    '</div>';
  }).join("");
}

async function openStop(code) {
  const found =
    S.allStops.find((s) => s.BusStopCode === code) ||
    S.nearbyStops.find((s) => s.BusStopCode === code);

  if (!found) return;

  S.stop = found;

  if (S.map) {
    S.map.panTo({ lat: found.Latitude, lng: found.Longitude });
  }

  document.getElementById("ph-name").textContent = found.Description;
  document.getElementById("ph-code").textContent = found.BusStopCode + " · ";
  document.getElementById("ph-road").textContent = found.RoadName;
  document.getElementById("arr-list").innerHTML = '<div class="state-box"><div class="spinner"></div></div>';
  document.getElementById("spanel").classList.add("open");

  await loadArrivals(code);
  startRefresh(code);
}

function closeStop() {
  document.getElementById("spanel").classList.remove("open");
  S.stop = null;
  stopRefresh();
}

async function loadArrivals(code) {
  try {
    const r = await fetch("/api/arrivals?code=" + code);
    const data = await r.json();

    if (data.error) throw new Error(data.error);

    renderArrivals(data);
  } catch (e) {
    document.getElementById("arr-list").innerHTML =
      '<div class="state-box"><div>⚠️ ' + e.message + '</div></div>';
  }
}

function renderArrivals(data) {
  const svcs = data.Services || [];
  const el = document.getElementById("arr-list");

  if (!svcs.length) {
    el.innerHTML = '<div class="state-box"><div>No services currently</div></div>';
    return;
  }

  el.innerHTML = svcs.map((svc) => {
    const m1 = getMin(svc.NextBus && svc.NextBus.EstimatedArrival);
    const dest = stopName((svc.NextBus && svc.NextBus.DestinationCode) || "");
    const op = svc.Operator || "";
    const buses = [svc.NextBus, svc.NextBus2, svc.NextBus3];

    return '<div class="svc-card" data-service-no="' + svc.ServiceNo + '" data-operator="' + op + '">' +
      '<div class="op-stripe op-' + (op || "default") + '"></div>' +
      '<div class="svc-hdr">' +
        '<div class="svc-num">' + svc.ServiceNo + '</div>' +
        '<div class="svc-dest">→ ' + dest + '</div>' +
        '<div class="svc-next">' + mt(m1) + '</div>' +
      '</div>' +
      '<div class="bus-rows">' + buses.map((b, i) => busRow(b, i)).join('') + '</div>' +
    '</div>';
  }).join('');
}

function busRow(bus, i) {
  if (!bus || !bus.EstimatedArrival) {
    return '<div class="bus-row"><span class="bseq">' + (i + 1) + '</span><span class="btime na">—</span></div>';
  }

  const m = getMin(bus.EstimatedArrival);
  const loadM = { SEA:["Seated","seated"], SDA:["Standing","standing"], LSD:["Crowded","crowded"] };
  const pair = loadM[bus.Load] || ["",""];
  const lt = pair[0];
  const lc = pair[1];

  return '<div class="bus-row">' +
    '<span class="bseq">' + (i + 1) + '</span>' +
    '<span class="btime">' + mt(m) + '</span>' +
    (lt ? '<span class="load-pill load-' + lc + '">' + lt + '</span>' : '') +
    '</div>';
}

function startRefresh(code) {
  stopRefresh();
  S.countdown = REFRESH;

  S.timer = setInterval(async () => {
    if (S.stop?.BusStopCode === code) {
      await loadArrivals(code);
      S.countdown = REFRESH;
    }
  }, REFRESH * 1000);

  S.ticker = setInterval(() => {
    S.countdown = Math.max(0, S.countdown - 1);
    updRefBar();
  }, 1000);

  updRefBar();
}

function stopRefresh() {
  clearInterval(S.timer);
  clearInterval(S.ticker);
}

function updRefBar() {
  document.getElementById("reftxt").textContent = "Refreshing in " + S.countdown + "s";
  document.getElementById("reffill").style.width = (S.countdown / REFRESH * 100) + "%";
}

async function showRoute(svcNo, op) {
  toast("Loading route for " + svcNo + "…");
}

function closeRoute() {
  document.getElementById("rpanel").classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {
  const inp = document.getElementById("q");
  const clr = document.getElementById("qclr");

  inp.addEventListener("input", () => {
    clr.style.display = inp.value ? "block" : "none";
  });

  clr.addEventListener("click", () => {
    inp.value = "";
    clr.style.display = "none";
    inp.focus();
  });

  document.getElementById("backbtn").addEventListener("click", closeStop);
  document.getElementById("rpclose").addEventListener("click", closeRoute);

  document.querySelectorAll(".sheet-tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".sheet-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      S.tab = t.dataset.tab;
      renderList();
      updateMarkers();
    });
  });

  document.getElementById("stops-list").addEventListener("click", (e) => {
    const card = e.target.closest(".stop-card");
    if (!card) return;
    const code = card.dataset.stopCode;
    if (code) openStop(code);
  });

  document.getElementById("arr-list").addEventListener("click", (e) => {
    const card = e.target.closest(".svc-card");
    if (!card) return;
    const svc = card.dataset.serviceNo;
    const op = card.dataset.operator || "";
    if (svc) showRoute(svc, op);
  });
});
</script>

<script>
console.log("GOOGLE_MAPS_KEY present:", ${mapsKey ? "true" : "false"});
console.log("GOOGLE_MAPS_KEY length:", ${mapsKey ? mapsKey.length : 0});
window.__MAP_KEY_DEBUG__ = {
  present: ${mapsKey ? "true" : "false"},
  length: ${mapsKey ? mapsKey.length : 0}
};

setTimeout(() => {
  if (!window.google || !window.google.maps) {
    console.error("Google Maps script did not initialize");
    document.getElementById("map-fallback").style.display = "flex";
  }
}, 6000);
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${mapsKey}&callback=initMap&loading=async&libraries=geometry,places"></script>
</body>
</html>`;
}