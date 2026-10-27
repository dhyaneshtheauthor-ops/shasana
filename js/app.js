/* Shasana — client-side app with hash routing */
const DATA = { inscriptions: [], kings: [] };
let mapInstance = null;

const $app = () => document.getElementById("app");

async function loadData() {
  const [arie, kings] = await Promise.all([
    fetch("data/arie_1918-1919_pandya.json").then(r => r.json()),
    fetch("data/kings_pandya.json").then(r => r.json())
  ]);
  DATA.inscriptions = arie;
  DATA.kings = kings.filter(k => k.king_id);
  buildIndexes();
}

const INDEX = { byKing: {}, byTemple: {}, temples: [] };

function buildIndexes() {
  INDEX.byKing = {};
  INDEX.byTemple = {};
  const templeMap = new Map();

  DATA.inscriptions.forEach(ins => {
    const kid = ins.king_identified_id || "unidentified";
    if (!INDEX.byKing[kid]) INDEX.byKing[kid] = [];
    INDEX.byKing[kid].push(ins);

    const tkey = (ins.temple || "Unknown temple") + "|" + (ins.temple_place || "");
    if (!templeMap.has(tkey)) {
      templeMap.set(tkey, {
        name: ins.temple || "Unknown temple",
        place: ins.temple_place || "",
        district: ins.temple_district || "",
        lat: ins.latitude,
        lng: ins.longitude,
        inscriptions: []
      });
    }
    templeMap.get(tkey).inscriptions.push(ins);
  });

  INDEX.temples = Array.from(templeMap.values()).sort((a,b) => b.inscriptions.length - a.inscriptions.length);
}

function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
}

/* Theme */
function initTheme() {
  const saved = localStorage.getItem("shasana-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeToggle").textContent = saved === "dark" ? "☀ Light" : "☾ Dark";
}
document.getElementById("themeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("shasana-theme", next);
  document.getElementById("themeToggle").textContent = next === "dark" ? "☀ Light" : "☾ Dark";
  if (mapInstance) updateMapTiles();
});

/* Routing */
function route() {
  const hash = location.hash.slice(1) || "/";
  const parts = hash.split("/").filter(Boolean);
  const page = parts[0] || "home";
  const id = parts[1];

  document.querySelectorAll(".bottom-nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === page || (page === "home" && a.dataset.nav === "home"));
  });

  if (page === "home" || page === "") renderHome();
  else if (page === "map") renderMap();
  else if (page === "temples") renderTemples();
  else if (page === "kings") renderKings();
  else if (page === "king" && id) renderKing(id);
  else if (page === "temple" && id) renderTemple(decodeURIComponent(id));
  else if (page === "inscription" && id) renderInscription(decodeURIComponent(id));
  else if (page === "search") renderSearch();
  else renderHome();
}

window.addEventListener("hashchange", route);

/* Views */
function renderHome() {
  const sample = DATA.inscriptions.slice(0, 4);
  $app().innerHTML = `
    <section class="hero">
      <div class="hero-tamil" id="heroText"></div>
      <div class="search-wrap">
        <input type="search" id="homeSearch" placeholder="Search king, temple, place, or keyword…" autocomplete="off">
      </div>
    </section>
    <div id="homeMap" class="mt" style="height:280px;border-radius:10px;overflow:hidden;border:1px solid var(--border)"></div>
    <p class="center"><a href="#/map" class="btn" style="display:inline-block;margin-top:8px">Open full map</a></p>
    <h2 class="mt">Key inscriptions</h2>
    <div class="grid grid-2 mt">
      ${sample.map(ins => inscriptionCard(ins)).join("")}
    </div>
  `;
  typewriter("heroText", "ஸ்ரீ மதுரை மீனாட்சி சுந்தரேசுவரர்");
  initMiniMap();
  document.getElementById("homeSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") location.hash = "#/search?q=" + encodeURIComponent(e.target.value);
  });
}

function typewriter(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  let i = 0;
  el.textContent = "";
  const step = () => {
    if (i <= text.length) {
      el.textContent = text.slice(0, i);
      i++;
      setTimeout(step, 55);
    }
  };
  step();
}

function inscriptionCard(ins) {
  return `<div class="card">
    <span class="tag tag-pandya">Pandya</span>
    <h3>${escapeHtml(ins.arie_no || ins.arie_id)}</h3>
    <p class="meta">${escapeHtml(ins.temple || "")} · ${escapeHtml(ins.temple_place || "")}</p>
    <p>${escapeHtml((ins.remarks || "").slice(0, 140))}${(ins.remarks||"").length>140?"…":""}</p>
    <a href="#/inscription/${encodeURIComponent(ins.arie_id)}">View inscription →</a>
  </div>`;
}

function renderSearch() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = params.get("q") || "";
  const results = q ? searchAll(q) : [];
  $app().innerHTML = `
    <h2>Search</h2>
    <div class="search-wrap" style="max-width:100%;margin:12px 0">
      <input type="search" id="q" value="${escapeHtml(q)}" placeholder="King, temple, place, keyword…">
    </div>
    <div id="results">${results.length ? results.map(r => r.html).join("") : (q ? "<p>No results.</p>" : "<p class='meta'>Type a query above.</p>")}</div>
  `;
  const input = document.getElementById("q");
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") location.hash = "#/search?q=" + encodeURIComponent(input.value);
  });
}

function searchAll(q) {
  const s = q.toLowerCase();
  const out = [];
  DATA.inscriptions.forEach(ins => {
    const blob = [ins.king, ins.temple, ins.temple_place, ins.temple_district, ins.remarks, ins.keywords, ins.arie_no].join(" ").toLowerCase();
    if (blob.includes(s)) out.push({ html: inscriptionCard(ins) });
  });
  DATA.kings.forEach(k => {
    if ((k.king_name_standard || "").toLowerCase().includes(s) || (k.short_bio || "").toLowerCase().includes(s)) {
      out.push({ html: `<div class="card"><span class="tag tag-pandya">King</span><h3>${escapeHtml(k.king_name_standard)}</h3><p>${escapeHtml((k.short_bio||"").slice(0,120))}</p><a href="#/king/${k.king_id}">View king →</a></div>` });
    }
  });
  return out;
}

function renderKings() {
  const primary = DATA.kings.filter(k => k.ruling_status === "primary" || (!k.ruling_status && k.accession_year_ce));
  const sorted = [...DATA.kings].sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
  $app().innerHTML = `
    <h2>Pandya Kings</h2>
    <p class="meta">Vertical timeline. Primary rulers and known co-rulers.</p>
    <div class="search-wrap" style="max-width:100%;margin:12px 0">
      <input type="search" id="kingSearch" placeholder="Find a king…">
    </div>
    <div id="kingList">${sorted.map(kingCard).join("")}</div>
  `;
  document.getElementById("kingSearch").addEventListener("input", e => {
    const s = e.target.value.toLowerCase();
    document.querySelectorAll("#kingList .king-card").forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(s) ? "" : "none";
    });
  });
}

function kingCard(k) {
  const sub = k.ruling_status === "subsidiary" ? " sub" : "";
  const years = (k.accession_year_ce && k.end_year_ce) ? `${k.accession_year_ce}–${k.end_year_ce}` : (k.century || "");
  return `<div class="king-card${sub}">
    <h4>${escapeHtml(k.king_name_standard)}</h4>
    <div class="years">${escapeHtml(years)} · ${escapeHtml(k.dynasty_branch || "")}</div>
    <p class="meta">${escapeHtml((k.short_bio || "").slice(0, 160))}</p>
    <a href="#/king/${k.king_id}" class="btn" style="display:inline-block;margin-top:6px;padding:6px 12px;font-size:.85rem">Read more</a>
  </div>`;
}

function renderKing(id) {
  const k = DATA.kings.find(x => x.king_id === id);
  if (!k) { $app().innerHTML = "<p>King not found.</p>"; return; }
  const insc = INDEX.byKing[id] || [];
  $app().innerHTML = `
    <p><a href="#/kings">← All kings</a></p>
    <h2>${escapeHtml(k.king_name_standard)}</h2>
    <p class="meta">${escapeHtml(k.dynasty_branch || "")} · ${k.accession_year_ce||"?"}–${k.end_year_ce||"?"}</p>
    <p>${escapeHtml(k.long_bio || k.short_bio || "")}</p>
    ${k.meykirti_prashasti ? `<p><strong>Meykirtti:</strong> ${escapeHtml(k.meykirti_prashasti)}</p>` : ""}
    <h3 class="mt">Inscriptions (${insc.length})</h3>
    <div id="kingInsc">${insc.map(ins => `<div class="list-item"><a href="#/inscription/${encodeURIComponent(ins.arie_id)}">${escapeHtml(ins.arie_no)}</a> — ${escapeHtml(ins.temple||"")} · ${escapeHtml(ins.date_raw||"")}</div>`).join("") || "<p>No inscriptions linked yet.</p>"}</div>
  `;
}

function renderTemples() {
  $app().innerHTML = `
    <h2>Temples</h2>
    <div class="search-wrap" style="max-width:100%;margin:12px 0">
      <input type="search" id="templeSearch" placeholder="Search temples…">
    </div>
    <div id="templeList">${INDEX.temples.map(t => templeListItem(t)).join("")}</div>
  `;
  document.getElementById("templeSearch").addEventListener("input", e => {
    const s = e.target.value.toLowerCase();
    document.querySelectorAll("#templeList .list-item").forEach(el => {
      el.style.display = el.textContent.toLowerCase().includes(s) ? "" : "none";
    });
  });
}

function templeListItem(t) {
  const slug = encodeURIComponent(t.name + "|" + t.place);
  return `<div class="list-item">
    <a href="#/temple/${slug}"><strong>${escapeHtml(t.name)}</strong></a>
    <span class="meta"> · ${escapeHtml(t.place)} · ${escapeHtml(t.district)} · ${t.inscriptions.length} inscriptions</span>
  </div>`;
}

function renderTemple(key) {
  const [name, place] = decodeURIComponent(key).split("|");
  const t = INDEX.temples.find(x => x.name === name && x.place === (place||""));
  if (!t) { $app().innerHTML = "<p>Temple not found.</p>"; return; }
  $app().innerHTML = `
    <p><a href="#/temples">← All temples</a></p>
    <h2>${escapeHtml(t.name)}</h2>
    <p class="meta">${escapeHtml(t.place)} · ${escapeHtml(t.district)}</p>
    <p>${t.inscriptions.length} inscriptions recorded.</p>
    <div class="mt">${t.inscriptions.map(ins => `<div class="list-item"><a href="#/inscription/${encodeURIComponent(ins.arie_id)}">${escapeHtml(ins.arie_no)}</a> — ${escapeHtml(ins.king||"")} · ${escapeHtml(ins.date_raw||"")} · ${escapeHtml(ins.location_within_temple||"")}</div>`).join("")}</div>
  `;
}

function renderInscription(id) {
  const ins = DATA.inscriptions.find(x => x.arie_id === id);
  if (!ins) { $app().innerHTML = "<p>Inscription not found.</p>"; return; }
  const kingLink = ins.king_identified_id ? `<a href="#/king/${ins.king_identified_id}">${escapeHtml(ins.king||"")}</a>` : escapeHtml(ins.king||"Unidentified");
  $app().innerHTML = `
    <p><a href="#/">← Home</a></p>
    <h2>${escapeHtml(ins.arie_no || ins.arie_id)}</h2>
    <div class="meta-strip">
      <div><strong>King</strong><br>${kingLink}</div>
      <div><strong>Regnal year</strong><br>${escapeHtml(ins.date_raw||"—")}</div>
      <div><strong>Date</strong><br>${escapeHtml(ins.date_identified||ins.century||"—")}</div>
      <div><strong>Temple</strong><br>${escapeHtml(ins.temple||"—")}</div>
      <div><strong>Place</strong><br>${escapeHtml(ins.temple_place||"—")}, ${escapeHtml(ins.temple_district||"")}</div>
      <div><strong>Language</strong><br>${escapeHtml(ins.language||"—")}</div>
      <div><strong>Citation</strong><br>${escapeHtml(ins.citation||"—")}</div>
    </div>
    <p>${escapeHtml(ins.remarks||"")}</p>
    ${ins.location_within_temple ? `<p class="meta">Location within temple: ${escapeHtml(ins.location_within_temple)}</p>` : ""}
    ${ins.keywords ? `<p class="meta">Keywords: ${escapeHtml(ins.keywords)}</p>` : ""}
  `;
}

/* Map */
function renderMap() {
  $app().innerHTML = `
    <h2>Map</h2>
    <div class="filters">
      <input type="search" id="mapSearch" placeholder="Filter temples…">
      <select id="mapCentury"><option value="">All centuries</option></select>
    </div>
    <div id="map" class="map-full"></div>
  `;
  initFullMap();
}

function initMiniMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const el = document.getElementById("homeMap");
  if (!el) return;
  mapInstance = L.map(el).setView([10.5, 78.5], 6);
  updateMapTiles();
  addTempleMarkers(mapInstance, 8);
}

function initFullMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map("map").setView([10.5, 78.5], 7);
  updateMapTiles();
  addTempleMarkers(mapInstance, 12);
}

function updateMapTiles() {
  if (!mapInstance) return;
  mapInstance.eachLayer(l => { if (l._url) mapInstance.removeLayer(l); });
  const theme = document.documentElement.getAttribute("data-theme");
  const url = theme === "dark"
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  L.tileLayer(url, { attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 18 }).addTo(mapInstance);
}

function addTempleMarkers(map, limit) {
  const temples = INDEX.temples.filter(t => t.lat && t.lng).slice(0, limit || 50);
  temples.forEach(t => {
    const color = "#3F7D6E";
    const marker = L.circleMarker([t.lat, t.lng], {
      radius: Math.min(6 + t.inscriptions.length, 16),
      fillColor: color, color: "#fff", weight: 1, fillOpacity: 0.85
    }).addTo(map);
    const slug = encodeURIComponent(t.name + "|" + t.place);
    marker.bindPopup(`<strong>${escapeHtml(t.name)}</strong><br>${escapeHtml(t.place)} · ${t.inscriptions.length} inscriptions<br><a href="#/temple/${slug}">See more →</a>`);
  });
}

/* Boot */
initTheme();
loadData().then(() => route()).catch(err => {
  $app().innerHTML = `<p>Could not load data. ${escapeHtml(err.message)}</p>`;
});
