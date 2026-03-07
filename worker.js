// ================================================================
//  BusNow SG — Cloudflare Worker
//  Personal Singapore bus arrival dashboard
// ================================================================

// ---------- SERVER-SIDE CACHE (per-isolate, resets on cold start) ----------
let _stopsCache = null;
let _stopsCacheAt = 0;
const STOPS_TTL = 6 * 3600 * 1000; // 6 hours

async function getAllStops(key) {
  if (_stopsCache && Date.now() - _stopsCacheAt < STOPS_TTL) return _stopsCache;
  const stops = [];
  let skip = 0;
  while (true) {
    const r = await fetch(
      `https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`,
      { headers: { AccountKey: key, accept: 'application/json' } }
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
      { headers: { AccountKey: key, accept: 'application/json' } }
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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ---------- MAIN HANDLER ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      // ── Serve frontend ──
      if (path === '/' || path === '/index.html') {
        return new Response(buildHTML(env.GOOGLE_MAPS_KEY || ''), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      if (!env.LTA_ACCOUNT_KEY)
        return json({ error: 'LTA_ACCOUNT_KEY not set in Worker secrets' }, 500);

      // ── Bus arrivals ──
      if (path === '/api/arrivals') {
        const code = url.searchParams.get('code');
        if (!code) return json({ error: 'Missing code' }, 400);
        const r = await fetch(
          `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${code}`,
          { headers: { AccountKey: env.LTA_ACCOUNT_KEY, accept: 'application/json' } }
        );
        return json(await r.json());
      }

      // ── All stops (cached) ──
      if (path === '/api/stops') {
        const stops = await getAllStops(env.LTA_ACCOUNT_KEY);
        return new Response(JSON.stringify(stops), {
          headers: {
            ...CORS,
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=21600',
          },
        });
      }

      // ── Bus route ──
      if (path === '/api/route') {
        const svc = url.searchParams.get('service');
        const dir = parseInt(url.searchParams.get('direction') || '1');
        if (!svc) return json({ error: 'Missing service' }, 400);

        const [route, stops] = await Promise.all([
          getRoute(env.LTA_ACCOUNT_KEY, svc, dir),
          getAllStops(env.LTA_ACCOUNT_KEY),
        ]);

        const sm = {};
        stops.forEach(s => (sm[s.BusStopCode] = s));

        const result = route.map(r => ({
          seq: r.StopSequence,
          code: r.BusStopCode,
          dist: r.Distance,
          name: sm[r.BusStopCode]?.Description || r.BusStopCode,
          road: sm[r.BusStopCode]?.RoadName || '',
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
      return json({ error: e.message }, 500);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ================================================================
//  FRONTEND HTML (injected inline by the Worker)
// ================================================================
function buildHTML(mapsKey) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>BusNow SG</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
/* ======== RESET ======== */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
button{cursor:pointer;font-family:inherit}

/* ======== TOKENS ======== */
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
  --r:12px;
  --shadow:0 8px 32px rgba(0,0,0,0.55);
}

html,body{height:100%;overflow:hidden;background:var(--bg);
  font-family:'Outfit',sans-serif;color:var(--text);
  -webkit-font-smoothing:antialiased}

/* ======== MAP ======== */
#map{position:fixed;inset:0;z-index:0}

/* ======== TOP BAR ======== */
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
  pointer-events:all;transition:border-color .2s,box-shadow .2s;
}
.search-bar:focus-within{
  border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-glow);
}
.search-bar svg{flex-shrink:0;opacity:.45}
.search-bar input{
  flex:1;background:none;border:none;outline:none;
  color:var(--text);font:inherit;font-size:13.5px;padding:0 8px;
}
.search-bar input::placeholder{color:var(--muted)}
#search-clear{
  background:none;border:none;color:var(--muted);
  font-size:18px;line-height:1;padding:0 2px;display:none
}

.icon-btn{
  width:40px;height:40px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;transition:all .2s;color:var(--text);
}
.icon-btn:hover,.icon-btn:active{background:var(--card);border-color:rgba(0,217,126,.4)}

/* ======== BOTTOM SHEET ======== */
.bottom-sheet{
  position:fixed;bottom:0;left:0;right:0;z-index:90;
  background:var(--surface);border-radius:20px 20px 0 0;
  border-top:1px solid var(--border);
  box-shadow:0 -8px 32px rgba(0,0,0,.45);
  display:flex;flex-direction:column;
  max-height:62vh;
  transition:transform .3s cubic-bezier(.4,0,.2,1);
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
  transition:all .2s;
}
.sheet-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.stops-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 0 24px}

/* ======== STOP CARD ======== */
.stop-card{
  display:flex;align-items:center;gap:12px;
  padding:11px 14px;cursor:pointer;
  transition:background .15s;
  border-bottom:1px solid rgba(255,255,255,.04)
}
.stop-card:hover,.stop-card:active{background:var(--card)}
.sc-icon{
  width:36px;height:36px;background:var(--card);border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;font-size:15px
}
.sc-info{flex:1;min-width:0}
.sc-name{
  font-size:13.5px;font-weight:500;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis
}
.sc-meta{font-size:11.5px;color:var(--muted);margin-top:2px}
.sc-code{
  font-family:'Space Mono',monospace;font-size:10px;
  background:var(--card);padding:1px 5px;border-radius:4px;margin-right:4px
}
.sc-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.sc-dist{font-size:12px;font-weight:600;color:var(--accent)}
.sc-walk{font-size:10px;color:var(--muted)}
.sc-fav{font-size:14px;color:var(--amber)}

/* ======== STOP PANEL ======== */
.stop-panel{
  position:fixed;inset:0;z-index:200;
  background:var(--bg);display:flex;flex-direction:column;
  transform:translateX(100%);
  transition:transform .3s cubic-bezier(.4,0,.2,1)
}
.stop-panel.open{transform:translateX(0)}
.panel-hdr{
  display:flex;align-items:center;gap:11px;
  padding:13px 14px;background:var(--surface);
  border-bottom:1px solid var(--border);flex-shrink:0;
}
.round-btn{
  width:36px;height:36px;display:flex;align-items:center;justify-content:center;
  background:var(--card);border:1px solid var(--border);
  border-radius:9px;color:var(--text);font-size:15px;
  transition:all .2s;flex-shrink:0
}
.round-btn:hover{background:var(--card2)}
.round-btn.fav-active{color:var(--amber);border-color:rgba(240,168,50,.3);background:rgba(240,168,50,.1)}
.ph-info{flex:1;min-width:0}
.ph-name{font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ph-sub{font-size:11.5px;color:var(--muted);margin-top:2px}
.ph-code{font-family:'Space Mono',monospace;color:var(--accent);font-size:11px}

.arrivals-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px 0}

/* ======== SERVICE CARD ======== */
.svc-card{
  margin:5px 11px;background:var(--card);
  border:1px solid var(--border);border-radius:var(--r);
  overflow:hidden;cursor:pointer;transition:all .2s;
}
.svc-card:hover,.svc-card:active{
  border-color:rgba(0,217,126,.3);background:var(--card2)
}
.svc-card .op-stripe{height:3px}
.svc-hdr{
  display:flex;align-items:center;gap:10px;
  padding:9px 13px 8px;
  border-bottom:1px solid rgba(255,255,255,.05)
}
.svc-num{
  font-family:'Space Mono',monospace;font-size:19px;font-weight:700;
  min-width:52px;
}
.svc-dest{flex:1;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.svc-next{font-family:'Space Mono',monospace;font-size:21px;font-weight:700;flex-shrink:0}
.svc-next.arriving{color:var(--red);animation:pulse 1.2s ease-in-out infinite}
.svc-next.soon{color:var(--amber)}
.svc-next.normal{color:var(--accent)}
.svc-next.na{color:var(--muted);font-size:16px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

.bus-rows{padding:7px 13px 8px;display:flex;flex-direction:column;gap:5px}
.bus-row{display:flex;align-items:center;gap:8px}
.bseq{
  width:18px;height:18px;border-radius:50%;background:var(--card2);
  font-size:10px;font-weight:600;color:var(--muted);
  display:flex;align-items:center;justify-content:center;flex-shrink:0
}
.btime{font-family:'Space Mono',monospace;font-size:13.5px;font-weight:700;min-width:52px}
.btime.arriving{color:var(--red)}
.btime.soon{color:var(--amber)}
.btime.normal{color:var(--accent)}
.btime.na{color:var(--muted)}
.load-pill{
  font-size:11px;font-weight:600;padding:2px 7px;
  border-radius:99px;flex-shrink:0
}
.load-seated{background:rgba(63,185,80,.14);color:var(--seated)}
.load-standing{background:rgba(240,168,50,.14);color:var(--standing)}
.load-crowded{background:rgba(248,81,73,.14);color:var(--crowded)}
.bbadges{display:flex;gap:4px;margin-left:auto}
.badge{
  font-size:9.5px;padding:1px 5px;border-radius:4px;
  background:var(--card2);color:var(--muted)
}
.badge.wab{background:rgba(88,166,255,.12);color:var(--blue)}
.badge.dd{background:rgba(0,217,126,.1);color:var(--accent)}

.svc-footer{
  padding:5px 13px 9px;font-size:11px;color:var(--muted);
  display:flex;align-items:center;justify-content:space-between
}
.route-tap{color:var(--accent);font-size:11px}

/* ======== OPERATOR STRIPE COLOURS ======== */
.op-SBST{background:#e8192c}
.op-SMRT{background:#0070b8}
.op-TOWT{background:#6f2c91}
.op-GAS{background:#009e6b}
.op-default{background:var(--accent)}

/* ======== REFRESH BAR ======== */
.refresh-bar{
  display:flex;align-items:center;gap:10px;
  padding:9px 14px;background:var(--surface);
  border-top:1px solid var(--border);flex-shrink:0
}
.refresh-txt{font-size:11.5px;color:var(--muted);flex:1}
.refresh-track{width:70px;height:3px;background:var(--card);border-radius:2px;overflow:hidden;flex-shrink:0}
.refresh-fill{height:100%;background:var(--accent);border-radius:2px;transition:width 1s linear}
.refresh-now-btn{
  font:inherit;font-size:11.5px;color:var(--accent);
  background:none;border:1px solid var(--accent-glow);
  border-radius:6px;padding:4px 9px;flex-shrink:0;transition:all .2s
}
.refresh-now-btn:hover{background:var(--accent-glow)}

/* ======== ROUTE PANEL ======== */
.route-panel{
  position:fixed;bottom:0;left:0;right:0;z-index:150;
  max-height:42vh;background:var(--surface);
  border-radius:20px 20px 0 0;border-top:1px solid var(--border);
  box-shadow:0 -8px 32px rgba(0,0,0,.55);
  display:flex;flex-direction:column;
  transform:translateY(100%);
  transition:transform .3s cubic-bezier(.4,0,.2,1)
}
.route-panel.open{transform:translateY(0)}
.rp-hdr{
  display:flex;align-items:center;gap:12px;
  padding:13px 14px 10px;flex-shrink:0;
  border-bottom:1px solid var(--border)
}
.rp-badge{
  font-family:'Space Mono',monospace;font-size:24px;font-weight:700;
  color:var(--accent);min-width:64px
}
.rp-info{flex:1}
.rp-title{font-size:13px;font-weight:500}
.rp-sub{font-size:11px;color:var(--muted);margin-top:2px}
.close-btn{
  width:32px;height:32px;display:flex;align-items:center;justify-content:center;
  background:var(--card);border:none;border-radius:50%;
  color:var(--muted);font-size:13px;transition:all .2s
}
.close-btn:hover{background:var(--card2);color:var(--text)}

.route-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 0 20px}
.rs-item{
  display:flex;align-items:flex-start;
  padding:4px 14px;cursor:pointer;transition:background .15s
}
.rs-item:hover{background:var(--card)}
.rs-item.cur{background:var(--accent-glow)}
.rs-line{display:flex;flex-direction:column;align-items:center;flex-shrink:0;width:22px;margin-top:4px}
.rs-dot{
  width:10px;height:10px;border-radius:50%;
  background:var(--muted);border:2px solid var(--surface);z-index:1
}
.rs-item.cur .rs-dot{background:var(--accent);width:12px;height:12px}
.rs-connector{width:2px;background:rgba(255,255,255,.1);flex:1;min-height:20px}
.rs-item:last-child .rs-connector{display:none}
.rs-text{flex:1;padding:2px 0 18px 8px}
.rs-name{font-size:13px;font-weight:500}
.rs-sub{font-size:11px;color:var(--muted);margin-top:1px}

/* ======== LOADING / EMPTY ======== */
.state-box{
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;padding:36px 20px;
  color:var(--muted);gap:10px;text-align:center
}
.spinner{
  width:24px;height:24px;border:2px solid var(--card2);
  border-top-color:var(--accent);border-radius:50%;
  animation:spin .75s linear infinite
}
@keyframes spin{to{transform:rotate(360deg)}}
.empty-emoji{font-size:28px;margin-bottom:4px}
.empty-msg{font-size:13px}
.empty-hint{font-size:11px;color:var(--muted);margin-top:2px}

/* ======== TOAST ======== */
.toast{
  position:fixed;top:74px;left:50%;
  transform:translateX(-50%) translateY(-12px);
  background:var(--card2);border:1px solid var(--border);
  color:var(--text);font-size:13px;
  padding:9px 16px;border-radius:8px;
  box-shadow:var(--shadow);z-index:999;
  opacity:0;transition:all .25s;
  white-space:nowrap;pointer-events:none;
  max-width:calc(100vw - 32px);text-align:center
}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ======== FIRST BUS INFO ======== */
.firstlast{
  display:flex;gap:8px;padding:6px 13px 0;
  flex-wrap:wrap;
}
.fl-pill{
  font-size:10px;font-family:'Space Mono',monospace;
  background:var(--card2);border-radius:6px;
  padding:3px 7px;color:var(--muted);
}

/* ======== DESKTOP ======== */
@media(min-width:768px){
  .top-bar{padding:16px 20px 0}
  .bottom-sheet{
    left:20px;right:auto;bottom:20px;width:360px;
    border-radius:16px;max-height:calc(100vh - 120px);
    border:1px solid var(--border)
  }
  .stop-panel{
    left:0;right:auto;width:400px;
    border-right:1px solid var(--border);
    transform:translateX(-100%)
  }
  .route-panel{
    left:20px;right:auto;bottom:20px;width:360px;
    border-radius:16px;border:1px solid var(--border);
    max-height:calc(100vh - 120px)
  }
}
</style>
</head>
<body>

<!-- Map -->
<div id="map"></div>
<!-- Toast -->
<div id="toast" class="toast"></div>

<!-- ── Top bar ── -->
<div class="top-bar">
  <div class="top-row">
    <div class="logo">Bus<span>Now</span></div>
    <div class="search-bar">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
      </svg>
      <input id="q" type="text" placeholder="Stop name, number, address, postal code…" autocomplete="off">
      <button id="qclr">×</button>
    </div>
    <button id="locbtn" class="icon-btn" title="Use my location">
      <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
      </svg>
    </button>
  </div>
</div>

<!-- ── Bottom sheet ── -->
<div id="bsheet" class="bottom-sheet">
  <div class="sheet-handle-area" id="shandle"><div class="handle-bar"></div></div>
  <div class="sheet-tabs">
    <button class="sheet-tab active" data-tab="nearby">Nearby</button>
    <button class="sheet-tab" data-tab="favorites">Favourites ★</button>
  </div>
  <div class="stops-list" id="stops-list">
    <div class="state-box"><div class="spinner"></div><span>Finding nearby stops…</span></div>
  </div>
</div>

<!-- ── Stop panel ── -->
<div id="spanel" class="stop-panel">
  <div class="panel-hdr">
    <button id="backbtn" class="round-btn">
      <svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path d="M19 12H5M12 5l-7 7 7 7"/>
      </svg>
    </button>
    <div class="ph-info">
      <div class="ph-name" id="ph-name"></div>
      <div class="ph-sub"><span class="ph-code" id="ph-code"></span><span id="ph-road"></span></div>
    </div>
    <button id="favbtn" class="round-btn" title="Favourite">
      <svg id="favico" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    </button>
  </div>
  <div class="arrivals-scroll" id="arr-list">
    <div class="state-box"><div class="spinner"></div></div>
  </div>
  <div class="refresh-bar">
    <span class="refresh-txt" id="reftxt">Refreshing in 30s</span>
    <div class="refresh-track"><div class="refresh-fill" id="reffill" style="width:100%"></div></div>
    <button class="refresh-now-btn" id="refnow">↺ Refresh</button>
  </div>
</div>

<!-- ── Route panel ── -->
<div id="rpanel" class="route-panel">
  <div class="rp-hdr">
    <div class="rp-badge" id="rp-num"></div>
    <div class="rp-info">
      <div class="rp-title" id="rp-title"></div>
      <div class="rp-sub" id="rp-sub"></div>
    </div>
    <button id="rpclose" class="close-btn">✕</button>
  </div>
  <div class="route-list" id="route-list"></div>
</div>

<script>
// ================================================================
//  BusNow SG — Frontend App
// ================================================================
const REFRESH = 30;

const S = {
  map: null, markers: {}, userMk: null, busMks: [],
  routeLine: null, allStops: [], nearbyStops: [],
  stop: null, center: null, tab: 'nearby',
  timer: null, ticker: null, countdown: REFRESH,
  favs: new Set(JSON.parse(localStorage.getItem('bnsg_favs')||'[]')),
  loadingStops: false, sheetCollapsed: false,
};

// ── UTILS ──
function haversine(a,b,c,d){
  const R=6371e3,p1=a*Math.PI/180,p2=c*Math.PI/180,
    dp=(c-a)*Math.PI/180,dl=(d-b)*Math.PI/180;
  const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function fmtDist(m){return m<1000?Math.round(m)+'m':(m/1000).toFixed(1)+'km'}
function fmtWalk(m){const s=m/1.2;return s<60?'<1 min walk':Math.ceil(s/60)+' min walk'}
function getMin(iso){if(!iso)return null;const m=(new Date(iso)-Date.now())/60000;return Math.max(0,Math.round(m))}
function mc(m){if(m===null)return 'na';if(m<=1)return 'arriving';if(m<=5)return 'soon';return 'normal'}
function mt(m){if(m===null)return '—';if(m===0)return 'Arr';return m+' min'}
function fmtT(iso){if(!iso)return '';return new Date(iso).toLocaleTimeString('en-SG',{hour:'2-digit',minute:'2-digit',hour12:true})}

function toast(msg,d=2600){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),d);
}

function opColor(op){
  const m={SBST:'#e8192c',SMRT:'#0070b8',TOWT:'#6f2c91',GAS:'#009e6b'};
  return m[op]||'#00d97e';
}

function stopName(code){
  const s=S.allStops.find(x=>x.BusStopCode===code);
  return s?s.Description:code;
}

// ── MAP INIT (called by Google Maps callback) ──
window.initMap=function(){
  const styles=[
    {elementType:'geometry',stylers:[{color:'#0d1117'}]},
    {elementType:'labels.text.fill',stylers:[{color:'#8b949e'}]},
    {elementType:'labels.text.stroke',stylers:[{color:'#0d1117'}]},
    {featureType:'road',elementType:'geometry',stylers:[{color:'#1c2333'}]},
    {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#0a0d14'}]},
    {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#21262d'}]},
    {featureType:'road',elementType:'labels.text.fill',stylers:[{color:'#586e83'}]},
    {featureType:'water',elementType:'geometry',stylers:[{color:'#060a0f'}]},
    {featureType:'water',elementType:'labels.text.fill',stylers:[{color:'#3d4e5f'}]},
    {featureType:'poi',stylers:[{visibility:'off'}]},
    {featureType:'poi.park',elementType:'geometry',stylers:[{color:'#0c1a0c'}]},
    {featureType:'transit',elementType:'labels',stylers:[{visibility:'off'}]},
    {featureType:'administrative',elementType:'geometry',stylers:[{color:'#1c2333'}]},
    {featureType:'landscape',elementType:'geometry',stylers:[{color:'#0d1117'}]},
  ];
  S.map=new google.maps.Map(document.getElementById('map'),{
    center:{lat:1.3521,lng:103.8198},zoom:15,
    styles,disableDefaultUI:true,gestureHandling:'greedy',
    clickableIcons:false,
  });
  // Click on map to pan & find nearest stop
  S.map.addListener('click',e=>{
    if(!S.allStops.length)return;
    const lat=e.latLng.lat(),lng=e.latLng.lng();
    const nearest=S.allStops
      .map(s=>({...s,d:haversine(lat,lng,s.Latitude,s.Longitude)}))
      .sort((a,b)=>a.d-b.d)[0];
    if(nearest&&nearest.d<300)openStop(nearest.BusStopCode);
    else{setCenter(lat,lng,false);toast('Showing stops near this location')}
  });
  boot();
};

async function boot(){
  loadAllStops();
  requestLoc();
}

// ── STOPS DATA ──
async function loadAllStops(){
  if(S.loadingStops)return;
  S.loadingStops=true;
  try{
    const r=await fetch('/api/stops');
    S.allStops=await r.json();
    if(S.center)updateNearby(S.center.lat,S.center.lng);
  }catch(e){toast('⚠ Could not load stops data')}
  S.loadingStops=false;
}

// ── LOCATION ──
function requestLoc(){
  if(!navigator.geolocation){defaultCenter();return}
  const btn=document.getElementById('locbtn');
  btn.style.borderColor='var(--accent)';
  navigator.geolocation.getCurrentPosition(
    p=>{btn.style.borderColor='';setCenter(p.coords.latitude,p.coords.longitude,true)},
    ()=>{btn.style.borderColor='';defaultCenter()},
    {timeout:12000,maximumAge:30000}
  );
}

function defaultCenter(){
  setCenter(1.3521,103.8198,false);
  toast('Enable GPS for accurate nearby stops');
}

function setCenter(lat,lng,isUser){
  S.center={lat,lng};
  S.map.setCenter({lat,lng});
  S.map.setZoom(16);
  if(isUser){
    if(S.userMk)S.userMk.setMap(null);
    S.userMk=new google.maps.Marker({
      position:{lat,lng},map:S.map,zIndex:100,
      icon:{path:google.maps.SymbolPath.CIRCLE,scale:8,
        fillColor:'#3b82f6',fillOpacity:1,
        strokeColor:'#fff',strokeWeight:2.5},
    });
  }
  if(S.allStops.length)updateNearby(lat,lng);
}

function updateNearby(lat,lng){
  const wd=S.allStops.map(s=>({...s,d:haversine(lat,lng,s.Latitude,s.Longitude)}))
    .sort((a,b)=>a.d-b.d);
  S.nearbyStops=wd.slice(0,8);
  renderList();updateMarkers();
}

// ── MARKERS ──
function updateMarkers(){
  Object.values(S.markers).forEach(m=>m.setMap(null));
  S.markers={};
  const stops=getListStops();
  stops.forEach(stop=>{
    if(!stop.Latitude)return;
    const sel=S.stop?.BusStopCode===stop.BusStopCode;
    const m=new google.maps.Marker({
      position:{lat:stop.Latitude,lng:stop.Longitude},
      map:S.map,title:stop.Description,
      icon:mkIcon(sel),zIndex:sel?10:5,
    });
    m.addListener('click',()=>openStop(stop.BusStopCode));
    S.markers[stop.BusStopCode]=m;
  });
}

function mkIcon(sel){
  return{
    path:google.maps.SymbolPath.CIRCLE,
    scale:sel?10:7,
    fillColor:sel?'#00d97e':'#e6edf3',
    fillOpacity:sel?1:.85,
    strokeColor:sel?'#00ff88':'#30363d',
    strokeWeight:sel?2.5:1.5,
  };
}

function getListStops(){
  if(S.tab==='favorites'){
    return S.allStops
      .filter(s=>S.favs.has(s.BusStopCode))
      .map(s=>({...s,d:S.center?haversine(S.center.lat,S.center.lng,s.Latitude,s.Longitude):0}))
      .sort((a,b)=>a.d-b.d);
  }
  return S.nearbyStops;
}

// ── RENDER LIST ──
function renderList(){
  const el=document.getElementById('stops-list');
  const stops=getListStops();
  if(!S.allStops.length){
    el.innerHTML='<div class="state-box"><div class="spinner"></div><span>Loading stops…</span></div>';return;
  }
  if(!stops.length){
    const msg=S.tab==='favorites'
      ?'<div class="state-box"><div class="empty-emoji">⭐</div><div class="empty-msg">No favourites yet</div><div class="empty-hint">Tap ★ on any stop to save it</div></div>'
      :'<div class="state-box"><div class="empty-emoji">🚌</div><div class="empty-msg">No stops found</div></div>';
    el.innerHTML=msg;return;
  }
  el.innerHTML=stops.map(s=>{
    const isFav=S.favs.has(s.BusStopCode);
    return '<div class="stop-card" onclick="openStop(\''+s.BusStopCode+'\')">'
      +'<div class="sc-icon">🚏</div>'
      +'<div class="sc-info">'
      +'<div class="sc-name">'+s.Description+'</div>'
      +'<div class="sc-meta"><span class="sc-code">'+s.BusStopCode+'</span>'+s.RoadName+'</div>'
      +'</div>'
      +(s.d!=null?'<div class="sc-right"><div class="sc-dist">'+fmtDist(s.d)+'</div><div class="sc-walk">'+fmtWalk(s.d)+'</div></div>':'')
      +(isFav?'<div class="sc-fav">★</div>':'')
      +'</div>';
  }).join('');
}

// ── OPEN STOP ──
async function openStop(code){
  const found=S.allStops.find(s=>s.BusStopCode===code)||S.nearbyStops.find(s=>s.BusStopCode===code);
  if(!found)return;
  S.stop=found;
  Object.entries(S.markers).forEach(([c,m])=>m.setIcon(mkIcon(c===code)));
  S.map.panTo({lat:found.Latitude,lng:found.Longitude});
  document.getElementById('ph-name').textContent=found.Description;
  document.getElementById('ph-code').textContent=found.BusStopCode+' · ';
  document.getElementById('ph-road').textContent=found.RoadName;
  const fb=document.getElementById('favbtn');
  const fi=document.getElementById('favico');
  fb.classList.toggle('fav-active',S.favs.has(code));
  fi.setAttribute('fill',S.favs.has(code)?'currentColor':'none');
  document.getElementById('arr-list').innerHTML='<div class="state-box"><div class="spinner"></div></div>';
  document.getElementById('spanel').classList.add('open');
  await loadArrivals(code);
  startRefresh(code);
}

function closeStop(){
  document.getElementById('spanel').classList.remove('open');
  S.stop=null;stopRefresh();clearBusMks();updateMarkers();
}

// ── ARRIVALS ──
async function loadArrivals(code){
  try{
    const r=await fetch('/api/arrivals?code='+code);
    const data=await r.json();
    if(data.error)throw new Error(data.error);
    renderArrivals(data);updateBusMks(data);
  }catch(e){
    document.getElementById('arr-list').innerHTML=
      '<div class="state-box"><div class="empty-emoji">⚠️</div><div class="empty-msg">'+e.message+'</div></div>';
  }
}

function renderArrivals(data){
  const svcs=data.Services||[];
  const el=document.getElementById('arr-list');
  if(!svcs.length){
    el.innerHTML='<div class="state-box"><div class="empty-emoji">🚌</div><div class="empty-msg">No services currently</div></div>';
    return;
  }
  el.innerHTML=svcs.map(svc=>{
    const m1=getMin(svc.NextBus&&svc.NextBus.EstimatedArrival);
    const dest=stopName(svc.NextBus&&svc.NextBus.DestinationCode||'');
    const op=svc.Operator||'';
    const buses=[svc.NextBus,svc.NextBus2,svc.NextBus3];
    const fl=buses[0]&&buses[0].EstimatedArrival
      ?'<div class="firstlast"><span class="fl-pill">Arr: '+fmtT(buses[0].EstimatedArrival)+'</span>'
        +(buses[1]&&buses[1].EstimatedArrival?'<span class="fl-pill">2nd: '+fmtT(buses[1].EstimatedArrival)+'</span>':'')
        +(buses[2]&&buses[2].EstimatedArrival?'<span class="fl-pill">3rd: '+fmtT(buses[2].EstimatedArrival)+'</span>':'')
        +'</div>':'';
    return '<div class="svc-card" onclick="showRoute(\''+svc.ServiceNo+'\',\''+op+'\')">'
      +'<div class="op-stripe op-'+(op||'default')+'"></div>'
      +'<div class="svc-hdr">'
      +'<div class="svc-num">'+svc.ServiceNo+'</div>'
      +'<div class="svc-dest">→ '+dest+'</div>'
      +'<div class="svc-next '+mc(m1)+'">'+mt(m1)+'</div>'
      +'</div>'
      +'<div class="bus-rows">'+buses.map((b,i)=>busRow(b,i)).join('')+'</div>'
      +fl
      +'<div class="svc-footer"><span style="color:var(--muted)">'+op+'</span>'
      +'<span class="route-tap">View route →</span></div>'
      +'</div>';
  }).join('');
}

function busRow(bus,i){
  if(!bus||!bus.EstimatedArrival){
    return '<div class="bus-row"><span class="bseq">'+(i+1)+'</span><span class="btime na">—</span></div>';
  }
  const m=getMin(bus.EstimatedArrival),cls=mc(m);
  const loadM={SEA:['Seated','seated'],SDA:['Standing','standing'],LSD:['Crowded','crowded']};
  const [lt,lc]=loadM[bus.Load]||['',''];
  const typeM={SD:'1-deck',DD:'2-deck',BD:'bendy'};
  return '<div class="bus-row">'
    +'<span class="bseq">'+(i+1)+'</span>'
    +'<span class="btime '+cls+'">'+mt(m)+'</span>'
    +(lt?'<span class="load-pill load-'+lc+'">'+lt+'</span>':'')
    +'<div class="bbadges">'
    +(bus.Feature==='WAB'?'<span class="badge wab">♿</span>':'')
    +(typeM[bus.Type]?'<span class="badge'+(bus.Type==='DD'?' dd':'')+'">'+typeM[bus.Type]+'</span>':'')
    +'</div></div>';
}

// ── LIVE BUS MARKERS ──
function clearBusMks(){S.busMks.forEach(m=>m.setMap(null));S.busMks=[]}

function updateBusMks(data){
  clearBusMks();
  const svcs=data.Services||[];
  svcs.forEach(svc=>{
    [svc.NextBus,svc.NextBus2,svc.NextBus3].forEach(bus=>{
      if(!bus)return;
      const lat=parseFloat(bus.Latitude),lng=parseFloat(bus.Longitude);
      if(!lat||!lng)return;
      const m=new google.maps.Marker({
        position:{lat,lng},map:S.map,
        title:'Bus '+svc.ServiceNo,zIndex:50,
        icon:{
          path:'M4 16s-1-1-1-3 1-11 7-11h4c6 0 7 9 7 11s-1 3-1 3H4zm3 2a1 1 0 1 0 2 0 1 1 0 0 0-2 0zm6 0a1 1 0 1 0 2 0 1 1 0 0 0-2 0z',
          fillColor:'#00d97e',fillOpacity:1,
          strokeColor:'#0d1117',strokeWeight:1,
          scale:1.2,anchor:new google.maps.Point(12,12),
        },
      });
      const iw=new google.maps.InfoWindow({
        content:'<div style="color:#e6edf3;background:#1c2333;padding:3px 8px;border-radius:5px;font-size:12px;font-family:monospace">'+svc.ServiceNo+'</div>'
      });
      m.addListener('click',()=>iw.open(S.map,m));
      S.busMks.push(m);
    });
  });
}

// ── REFRESH ──
function startRefresh(code){
  stopRefresh();S.countdown=REFRESH;
  S.timer=setInterval(async()=>{
    if(S.stop?.BusStopCode===code){await loadArrivals(code);S.countdown=REFRESH}
  },REFRESH*1000);
  S.ticker=setInterval(()=>{S.countdown=Math.max(0,S.countdown-1);updRefBar()},1000);
  updRefBar();
}
function stopRefresh(){clearInterval(S.timer);clearInterval(S.ticker)}
function updRefBar(){
  document.getElementById('reftxt').textContent='Refreshing in '+S.countdown+'s';
  document.getElementById('reffill').style.width=(S.countdown/REFRESH*100)+'%';
}

// ── ROUTE ──
async function showRoute(svcNo,op){
  toast('Loading route for '+svcNo+'…');
  try{
    const r1=await fetch('/api/route?service='+svcNo+'&direction=1');
    let stops=await r1.json();
    // Try direction 2 if direction 1 seems wrong (heuristic: dest of current trip)
    if(S.stop&&stops.length>0){
      const destCode=S.stop?.BusStopCode;
      const inRoute=stops.some(s=>s.code===destCode);
      if(!inRoute){
        const r2=await fetch('/api/route?service='+svcNo+'&direction=2');
        const s2=await r2.json();
        if(s2.length>0)stops=s2;
      }
    }
    drawRoute(stops);renderRoutePanel(svcNo,stops,op);
  }catch(e){toast('Failed to load route')}
}

function drawRoute(stops){
  if(S.routeLine)S.routeLine.setMap(null);
  const path=stops.filter(s=>s.lat&&s.lng).map(s=>({lat:s.lat,lng:s.lng}));
  if(!path.length)return;
  S.routeLine=new google.maps.Polyline({
    path,geodesic:true,
    strokeColor:'#00ff88',strokeOpacity:.88,strokeWeight:4.5,
    map:S.map,
  });
  const bounds=new google.maps.LatLngBounds();
  path.forEach(p=>bounds.extend(p));
  S.map.fitBounds(bounds,{top:80,bottom:160,left:16,right:16});
}

function renderRoutePanel(svc,stops,op){
  document.getElementById('rp-num').textContent=svc;
  document.getElementById('rp-num').style.color=opColor(op);
  const first=stops[0],last=stops[stops.length-1];
  document.getElementById('rp-title').textContent=
    (first?first.name:'')+(last?' → '+last.name:'');
  document.getElementById('rp-sub').textContent=stops.length+' stops';
  const curCode=S.stop?.BusStopCode;
  const list=document.getElementById('route-list');
  list.innerHTML=stops.map((s,i)=>{
    const isCur=s.code===curCode;
    return '<div class="rs-item'+(isCur?' cur':'')+'" onclick="openStop(\''+s.code+'\')">'
      +'<div class="rs-line"><div class="rs-dot"></div>'
      +(i<stops.length-1?'<div class="rs-connector"></div>':'')
      +'</div>'
      +'<div class="rs-text"><div class="rs-name">'+s.name+'</div>'
      +'<div class="rs-sub">'+s.code+(s.road?' · '+s.road:'')+'</div>'
      +'</div></div>';
  }).join('');
  document.getElementById('rpanel').classList.add('open');
  const curEl=list.querySelector('.cur');
  if(curEl)setTimeout(()=>curEl.scrollIntoView({behavior:'smooth',block:'center'}),300);
}

function closeRoute(){
  if(S.routeLine){S.routeLine.setMap(null);S.routeLine=null}
  document.getElementById('rpanel').classList.remove('open');
}

// ── SEARCH ──
async function handleSearch(q){
  q=q.trim();if(!q)return;
  // Bus stop code
  if(/^\\d{5,6}$/.test(q)){
    const s=S.allStops.find(x=>x.BusStopCode===q);
    if(s){openAndCenter(s);return}
  }
  // Coordinates
  const co=q.match(/^(-?\\d+\\.?\\d*)[,\\s]+(-?\\d+\\.?\\d*)$/);
  if(co){
    const lat=parseFloat(co[1]),lng=parseFloat(co[2]);
    if(lat>1&&lat<1.5&&lng>103&&lng<104.5){
      setCenter(lat,lng,false);toast('Showing stops near '+lat.toFixed(5)+', '+lng.toFixed(5));return;
    }
  }
  // Text search
  const ql=q.toLowerCase();
  const m=S.allStops.filter(s=>s.Description.toLowerCase().includes(ql)||s.RoadName.toLowerCase().includes(ql));
  if(m.length===1){openAndCenter(m[0]);return}
  if(m.length>1&&m.length<=30){
    const ref=m[0];
    S.center={lat:ref.Latitude,lng:ref.Longitude};
    S.nearbyStops=m.slice(0,8).map(s=>({...s,d:haversine(ref.Latitude,ref.Longitude,s.Latitude,s.Longitude)}));
    renderList();updateMarkers();
    S.map.setCenter({lat:ref.Latitude,lng:ref.Longitude});S.map.setZoom(15);
    toast('Found '+m.length+' stops matching "'+q+'"');return;
  }
  // Geocode
  geocode(q);
}

function openAndCenter(s){
  S.map.setCenter({lat:s.Latitude,lng:s.Longitude});S.map.setZoom(17);
  openStop(s.BusStopCode);
}

function geocode(q){
  const gc=new google.maps.Geocoder();
  gc.geocode({address:q+', Singapore'},(res,status)=>{
    if(status==='OK'&&res[0]){
      const {lat,lng}=res[0].geometry.location;
      setCenter(lat(),lng(),false);
      toast('Showing stops near '+res[0].formatted_address);
    }else toast('Location not found. Try a stop code, name, or address.');
  });
}

// ── FAVOURITES ──
function toggleFav(code){
  if(S.favs.has(code)){S.favs.delete(code);toast('Removed from favourites')}
  else{S.favs.add(code);toast('Added to favourites ⭐')}
  localStorage.setItem('bnsg_favs',JSON.stringify([...S.favs]));
  const fb=document.getElementById('favbtn');
  const fi=document.getElementById('favico');
  fb.classList.toggle('fav-active',S.favs.has(code));
  fi.setAttribute('fill',S.favs.has(code)?'currentColor':'none');
  if(S.tab==='favorites')renderList();
}

// ── EVENTS ──
document.addEventListener('DOMContentLoaded',()=>{
  const inp=document.getElementById('q');
  const clr=document.getElementById('qclr');
  inp.addEventListener('input',()=>{clr.style.display=inp.value?'block':'none'});
  clr.addEventListener('click',()=>{inp.value='';clr.style.display='none';inp.focus()});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){handleSearch(inp.value);inp.blur()}});
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&document.activeElement!==inp){e.preventDefault();inp.focus();inp.select()}
  });
  document.getElementById('locbtn').addEventListener('click',requestLoc);
  document.getElementById('backbtn').addEventListener('click',closeStop);
  document.getElementById('favbtn').addEventListener('click',()=>{if(S.stop)toggleFav(S.stop.BusStopCode)});
  document.getElementById('refnow').addEventListener('click',()=>{
    if(S.stop){loadArrivals(S.stop.BusStopCode);S.countdown=REFRESH;updRefBar()}
  });
  document.getElementById('rpclose').addEventListener('click',closeRoute);
  document.querySelectorAll('.sheet-tab').forEach(t=>t.addEventListener('click',()=>{
    document.querySelectorAll('.sheet-tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');S.tab=t.dataset.tab;
    renderList();updateMarkers();
  }));
  document.getElementById('shandle').addEventListener('click',()=>{
    const sh=document.getElementById('bsheet');
    S.sheetCollapsed=!S.sheetCollapsed;
    sh.style.transform=S.sheetCollapsed?'translateY(calc(100% - 88px))':'';
  });
});

window.openStop=openStop;
window.showRoute=showRoute;
</script>

<!-- Load Google Maps API -->
<script src="https://maps.googleapis.com/maps/api/js?key=${mapsKey}&callback=initMap&libraries=geometry,places" async defer></script>
</body>
</html>`;
}
