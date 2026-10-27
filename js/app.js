/* Shasana — redesigned client app */
const DATA = { inscriptions: [], kings: [] };
let mapInstance = null;
const CARTO_KEY = "cb1_4vlf_1_e392d35f157b6850d4b0be27";

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

const INDEX = { byKing: {}, temples: [] };

function buildIndexes() {
  INDEX.byKing = {};
  const templeMap = new Map();
  DATA.inscriptions.forEach(ins => {
    const kid = ins.king_identified_id || "unidentified";
    if (!INDEX.byKing[kid]) INDEX.byKing[kid] = [];
    INDEX.byKing[kid].push(ins);
    const tkey = (ins.temple || "") + "|" + (ins.temple_place || "");
    if (!templeMap.has(tkey)) {
      templeMap.set(tkey, {
        name: ins.temple || "Temple not recorded",
        place: ins.temple_place || "",
        district: titleCase(ins.temple_district || ""),
        lat: ins.latitude, lng: ins.longitude,
        inscriptions: [], dynasties: new Set()
      });
    }
    const t = templeMap.get(tkey);
    t.inscriptions.push(ins);
    if (ins.dynasty_normalized) t.dynasties.add(ins.dynasty_normalized);
  });
  INDEX.temples = Array.from(templeMap.values()).sort((a,b) => b.inscriptions.length - a.inscriptions.length);
}

function titleCase(s) { return (s || "").replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
}
function formatDate(raw, identified) {
  if (identified) return escapeHtml(identified);
  if (!raw || raw === "…" || raw === "...") return "Unidentified Date";
  return `<span class="mono-chip" title="Regnal year notation from the source">${escapeHtml(raw)}</span>`;
}
function placeholder(letter) {
  return `<div class="placeholder-img">${escapeHtml((letter||"?").charAt(0).toUpperCase())}</div>`;
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
      setTimeout(step, 45);
    }
  };
  step();
}

/* Theme */
function initTheme() {
  const saved = localStorage.getItem("shasana-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeToggle").textContent = saved === "dark" ? "☀ Light" : "☾ Dark";
}
document.getElementById("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("shasana-theme", next);
  document.getElementById("themeToggle").textContent = next === "dark" ? "☀ Light" : "☾ Dark";
  if (mapInstance) updateMapTiles();
});

/* Routing */
function route() {
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  const page = parts[0] || "home";
  const id = parts[1];
  document.querySelectorAll(".top-nav a, .bottom-nav a").forEach(a => {
    a.classList.toggle("active", a.dataset.nav === page || (page === "home" && a.dataset.nav === "home"));
  });
  if (page === "home" || !page) renderHome();
  else if (page === "map") renderMap();
  else if (page === "temples") renderTemples();
  else if (page === "kings") renderKings();
  else if (page === "king" && id) renderKing(id);
  else if (page === "temple" && id) renderTemple(decodeURIComponent(id));
  else if (page === "inscription" && id) renderInscription(decodeURIComponent(id));
  else if (page === "search") renderSearch(qs);
  else renderHome();
}
window.addEventListener("hashchange", route);

/* HOME */
function renderHome() {
  const totalInsc = DATA.inscriptions.length;
  const totalTemples = INDEX.temples.length;
  const totalKings = DATA.kings.length;
  const centuries = new Set(DATA.inscriptions.map(i => i.century).filter(Boolean)).size;
  const featured = INDEX.temples.slice(0, 6);
  const featuredIns = DATA.inscriptions[Math.floor(Math.random() * Math.min(DATA.inscriptions.length, 20))] || DATA.inscriptions[0];
  $app().innerHTML = `
    <section class="hero hero-full" style="background-image: linear-gradient(180deg, rgba(28,26,24,.45), rgba(28,26,24,.75)), url('images/website_header.png');">
      <h2 id="heroText"></h2>
      <div class="search-wrap">
        <input type="search" id="homeSearch" placeholder="Search king, temple, place, or keyword…" autocomplete="off">
      </div>
    </section>
    <div class="stats">
      <div class="stat"><div class="num">${totalInsc}</div><div class="lbl">Inscriptions</div></div>
      <div class="stat"><div class="num">${totalTemples}</div><div class="lbl">Temples</div></div>
      <div class="stat"><div class="num">${totalKings}</div><div class="lbl">Kings</div></div>
      <div class="stat"><div class="num">${centuries}</div><div class="lbl">Centuries</div></div>
    </div>
    <div id="homeMap" style="height:320px;border-radius:12px;overflow:hidden;border:1px solid var(--border);margin:16px 0"></div>
    <p class="center"><a href="#/map" class="btn" style="display:inline-block;background:var(--kumkum);color:#fff;padding:10px 20px;border-radius:8px;font-weight:600">Open full map</a></p>
    <h3 class="section-title">Featured temples</h3>
    <div class="hscroll">${featured.map(t => templeCard(t)).join("")}</div>
    ${featuredIns ? `
    <h3 class="section-title">Inscription of the day</h3>
    <div class="insc-card">
      <span class="are-badge">${escapeHtml(featuredIns.arie_no||"")}</span>
      <h3 style="margin:8px 0 4px">${escapeHtml(featuredIns.temple||"Temple not recorded")}</h3>
      <p class="muted">${escapeHtml((featuredIns.remarks||"").slice(0,180))}${(featuredIns.remarks||"").length>180?"…":""}</p>
      <p class="muted">${escapeHtml(featuredIns.king||"")} · ${escapeHtml(featuredIns.temple_place||"")}</p>
      <a href="#/inscription/${encodeURIComponent(featuredIns.arie_id)}">View inscription →</a>
    </div>` : ""}
    <h3 class="section-title">Browse by dynasty</h3>
    <div class="dynasty-row">
      <div class="dynasty-card pandya" onclick="location.hash='#/kings'">
        <div class="emblem"><img src="images/icons/pandya_emblem.png" alt="Pandya" width="48" height="48"></div>
        <h3>Pandya</h3>
        <p class="muted">${DATA.kings.length} kings recorded</p>
      </div>
      <div class="dynasty-card chola" onclick="location.hash='#/kings'">
        <div class="emblem"><img src="images/icons/chola_emblem.png" alt="Chola" width="48" height="48"></div>
        <h3>Chola</h3>
        <p class="muted">Coming soon</p>
      </div>
    </div>
  `;
  document.getElementById("homeSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") location.hash = "#/search?q=" + encodeURIComponent(e.target.value);
  });
  typewriter("heroText", "Explore Ancient India like Never Before");
  initMiniMap();
}

function templeCard(t) {
  const slug = encodeURIComponent(t.name + "|" + t.place);
  const letter = (t.name || "?").charAt(0);
  const dots = [...t.dynasties].map(d => `<span class="dot dot-${d.toLowerCase()}"></span>`).join("");
  return `<a href="#/temple/${slug}" class="card temple-card" style="text-decoration:none;color:inherit">
    <div class="overlay">${placeholder(letter)}<h3>${escapeHtml(t.name)}</h3></div>
    <div class="card-body">
      <span class="muted">${escapeHtml(t.place)}${t.district?" · "+escapeHtml(t.district):""}</span>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <span class="badge">${t.inscriptions.length}</span>
        <div class="dots">${dots}</div>
      </div>
    </div>
  </a>`;
}

/* TEMPLES */
function renderTemples() {
  $app().innerHTML = `
    <h2>Temples</h2>
    <div class="filters">
      <input type="search" id="tSearch" placeholder="Search…" style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
      <select id="tSort" style="padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
        <option value="count">Most inscriptions</option>
        <option value="az">A to Z</option>
      </select>
    </div>
    <div class="temple-grid" id="templeGrid">${INDEX.temples.map(t => templeCard(t)).join("")}</div>
  `;
  const grid = document.getElementById("templeGrid");
  const search = document.getElementById("tSearch");
  const sort = document.getElementById("tSort");
  function update() {
    let list = [...INDEX.temples];
    const q = search.value.toLowerCase();
    if (q) list = list.filter(t => (t.name+" "+t.place+" "+t.district).toLowerCase().includes(q));
    if (sort.value === "az") list.sort((a,b) => a.name.localeCompare(b.name));
    else list.sort((a,b) => b.inscriptions.length - a.inscriptions.length);
    grid.innerHTML = list.map(t => templeCard(t)).join("");
  }
  search.addEventListener("input", update);
  sort.addEventListener("change", update);
}

function renderTemple(key) {
  const [name, place] = decodeURIComponent(key).split("|");
  const t = INDEX.temples.find(x => x.name === name && x.place === (place||""));
  if (!t) { $app().innerHTML = "<p>Temple not found.</p>"; return; }
  const dates = t.inscriptions.map(i => i.date_identified).filter(Boolean);
  $app().innerHTML = `
    <p><a href="#/temples">← Temples</a></p>
    <div class="hero" style="min-height:220px">
      <h2>${escapeHtml(t.name)}</h2>
      <p class="muted">${escapeHtml(t.place)} · ${escapeHtml(t.district)}</p>
    </div>
    <div class="stats">
      <div class="stat"><div class="num">${t.inscriptions.length}</div><div class="lbl">Inscriptions</div></div>
      <div class="stat"><div class="num">${dates.length?dates[0]:"—"}</div><div class="lbl">Earliest</div></div>
      <div class="stat"><div class="num">${dates.length?dates[dates.length-1]:"—"}</div><div class="lbl">Latest</div></div>
      <div class="stat"><div class="num">${new Set(t.inscriptions.map(i=>i.king_identified_id).filter(Boolean)).size}</div><div class="lbl">Kings</div></div>
    </div>
    <h3 class="section-title">Inscriptions</h3>
    ${t.inscriptions.map(ins => inscCard(ins)).join("")}
  `;
}

function inscCard(ins) {
  const dyn = (ins.dynasty_normalized||"").toLowerCase();
  return `<div class="insc-card ${dyn}">
    <span class="are-badge">${escapeHtml(ins.arie_no||ins.arie_id)}</span>
    <span class="muted" style="margin-left:8px">${formatDate(ins.date_raw, ins.date_identified)}</span>
    <h4 style="margin:8px 0 4px">${ins.king_identified_id ? `<a href="#/king/${ins.king_identified_id}">${escapeHtml(ins.king||"")}</a>` : escapeHtml(ins.king||"Unidentified")}</h4>
    <p class="muted">${escapeHtml((ins.remarks||"").slice(0,160))}</p>
    ${ins.location_within_temple ? `<p class="muted">${escapeHtml(ins.location_within_temple)}</p>` : ""}
    <a href="#/inscription/${encodeURIComponent(ins.arie_id)}">View →</a>
  </div>`;
}

/* KINGS */
function renderKings() {
  const sorted = [...DATA.kings].sort((a,b) => (a.sort_order||0) - (b.sort_order||0));
  $app().innerHTML = `
    <h2><img src="images/icons/pandya_emblem.png" alt="" width="36" height="36" style="vertical-align:middle;margin-right:8px">Pandya Dynasty</h2>    <div class="timeline-scroll" id="tl">${sorted.filter(k=>k.accession_year_ce).map(k => {
      const span = Math.max(1, (k.end_year_ce||k.accession_year_ce) - k.accession_year_ce);
      return `<div class="tl-bar" style="height:${20+Math.min(span,40)}px" title="${escapeHtml(k.king_name_standard)}" onclick="document.getElementById('k-${k.king_id}')?.scrollIntoView({behavior:'smooth'})">${span}</div>`;
    }).join("")}</div>
    <div class="search-wrap" style="max-width:100%;margin:12px 0">
      <input type="search" id="kingSearch" placeholder="Find a king…">
    </div>
    <div id="kingList">${sorted.map(k => kingCard(k)).join("")}</div>
  `;
  document.getElementById("kingSearch").addEventListener("input", e => {
    const s = e.target.value.toLowerCase();
    document.querySelectorAll("#kingList .card").forEach(c => c.style.display = c.textContent.toLowerCase().includes(s) ? "" : "none");
  });
}

function kingCard(k) {
  const years = (k.accession_year_ce && k.end_year_ce) ? `${k.accession_year_ce}–${k.end_year_ce}` : (k.century||"");
  const count = (INDEX.byKing[k.king_id]||[]).length;
  return `<a href="#/king/${k.king_id}" id="k-${k.king_id}" class="card" style="display:block;text-decoration:none;color:inherit;margin-bottom:12px;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <img src="images/icons/pandya_emblem.png" alt="" width="20" height="20" style="vertical-align:middle;margin-right:6px">
        <span class="tag tag-pandya">${escapeHtml(k.dynasty_branch||"Pandya")}</span>
        <h3 style="margin:6px 0 4px">${escapeHtml(k.king_name_standard)}</h3>
        <p class="muted">${escapeHtml(years)}</p>
        <p>${escapeHtml((k.short_bio||"").slice(0,140))}</p>
      </div>
      <span style="color:var(--gold)">→</span>
    </div>
    ${count ? `<span class="badge">${count} inscriptions</span>` : ""}
  </a>`;
}

function renderKing(id) {
  const k = DATA.kings.find(x => x.king_id === id);
  if (!k) { $app().innerHTML = "<p>King not found.</p>"; return; }
  const insc = INDEX.byKing[id] || [];
  const years = (k.accession_year_ce && k.end_year_ce) ? `${k.accession_year_ce}–${k.end_year_ce} CE` : (k.century||"");
  $app().innerHTML = `
    <p><a href="#/kings">← Dynasty</a></p>
    <div class="king-layout">
      <div>
        ${placeholder(k.king_name_standard)}
        <h2>${escapeHtml(k.king_name_standard)}</h2>
        <div class="king-bio">${escapeHtml(k.long_bio || k.short_bio || "")}</div>
        ${k.meykirti_prashasti ? `<div class="meykirtti">${escapeHtml(k.meykirti_prashasti)}</div>` : ""}
        <h3 class="section-title">Inscriptions (${insc.length})</h3>
        ${insc.map(ins => inscCard(ins)).join("") || "<p class='muted'>No inscriptions linked yet.</p>"}
      </div>
      <aside class="facts">
        <dl>
          <dt>Reign</dt><dd>${escapeHtml(years)}</dd>
          <dt>Era</dt><dd>${escapeHtml(k.dynasty_branch||"—")}</dd>
          <dt>Inscriptions</dt><dd>${insc.length}</dd>
          ${k.common_titles ? `<dt>Titles</dt><dd>${escapeHtml(k.common_titles)}</dd>` : ""}
        </dl>
      </aside>
    </div>
  `;
}

/* INSCRIPTION */
function renderInscription(id) {
  const ins = DATA.inscriptions.find(x => x.arie_id === id);
  if (!ins) { $app().innerHTML = "<p>Inscription not found.</p>"; return; }
  const kingLink = ins.king_identified_id ? `<a href="#/king/${ins.king_identified_id}">${escapeHtml(ins.king||"")}</a>` : escapeHtml(ins.king||"Unidentified");
  $app().innerHTML = `
    <p><a href="#/">← Home</a></p>
    <span class="tag tag-pandya"><img src="images/icons/pandya_emblem.png" alt="" width="16" height="16" style="vertical-align:middle;margin-right:4px">Pandya</span>
    <h2>${escapeHtml(ins.arie_no || ins.arie_id)}</h2>
    <p class="muted">${escapeHtml(ins.citation||"")}</p>
    <div class="stats">
      <div class="stat"><div class="lbl">King</div><div>${kingLink}</div></div>
      <div class="stat"><div class="lbl">Date</div><div>${formatDate(ins.date_raw, ins.date_identified)}</div></div>
      <div class="stat"><div class="lbl">Temple</div><div>${escapeHtml(ins.temple||"Temple not recorded")}</div></div>
      <div class="stat"><div class="lbl">Place</div><div>${escapeHtml(ins.temple_place||"")}, ${escapeHtml(titleCase(ins.temple_district||""))}</div></div>
    </div>
    <div class="insc-card">${escapeHtml(ins.remarks||"No summary available.")}</div>
    ${ins.location_within_temple ? `<p class="muted">Location: ${escapeHtml(ins.location_within_temple)}</p>` : ""}
    ${ins.keywords ? `<p class="muted">Keywords: ${escapeHtml(ins.keywords)}</p>` : ""}
  `;
}

/* SEARCH */
function renderSearch(qs) {
  const params = new URLSearchParams(qs||"");
  const q = params.get("q") || "";
  const results = q ? searchAll(q) : [];
  $app().innerHTML = `
    <h2>Search</h2>
    <div class="search-wrap" style="max-width:100%;margin:12px 0">
      <input type="search" id="q" value="${escapeHtml(q)}" placeholder="King, temple, place, keyword…">
    </div>
    <div id="results">${results.length ? results.map(r => r.html).join("") : (q ? "<p class='muted'>No results.</p>" : "<p class='muted'>Type a query above.</p>")}</div>
  `;
  document.getElementById("q").addEventListener("keydown", e => {
    if (e.key === "Enter") location.hash = "#/search?q=" + encodeURIComponent(e.target.value);
  });
}
function searchAll(q) {
  const s = q.toLowerCase();
  const out = [];
  DATA.inscriptions.forEach(ins => {
    const blob = [ins.king, ins.temple, ins.temple_place, ins.temple_district, ins.remarks, ins.keywords, ins.arie_no].join(" ").toLowerCase();
    if (blob.includes(s)) out.push({ html: inscCard(ins) });
  });
  DATA.kings.forEach(k => {
    if ((k.king_name_standard||"").toLowerCase().includes(s)) out.push({ html: kingCard(k) });
  });
  return out;
}

/* MAP */
function renderMap() {
  $app().innerHTML = `
    <div class="filters">
      <button class="chip active" data-f="all">All</button>
      <button class="chip" data-f="pandya">Pandya</button>
    </div>
    <div class="map-layout">
      <div id="map"></div>
      <aside class="side-panel" id="sidePanel"><p class="muted">Temples in view will appear here.</p></aside>
    </div>
  `;
  initFullMap();
}

function initMiniMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const el = document.getElementById("homeMap");
  if (!el) return;
  mapInstance = L.map(el).setView([10.5, 78.5], 6);
  updateMapTiles();
  addMarkers(mapInstance, 12);
}
function initFullMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map("map").setView([10.5, 78.5], 7);
  updateMapTiles();
  addMarkers(mapInstance, 50);
  updateSidePanel();
  mapInstance.on("moveend", updateSidePanel);
}
function updateMapTiles() {
  if (!mapInstance) return;
  mapInstance.eachLayer(l => { if (l._url) mapInstance.removeLayer(l); });
  const theme = document.documentElement.getAttribute("data-theme");
  const style = theme === "dark" ? "dark_all" : "light_all";
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${CARTO_KEY}`, {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 18
  }).addTo(mapInstance);
}
function addMarkers(map, limit) {
  INDEX.temples.filter(t => t.lat && t.lng).slice(0, limit).forEach(t => {
    const count = t.inscriptions.length;
    const size = Math.min(56, Math.max(28, 20 + count * 2));
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#3F7D6E;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${size>40?14:11}px;border:2px solid #fff">${count}</div>`,
      iconSize: [size, size], iconAnchor: [size/2, size/2]
    });
    const m = L.marker([t.lat, t.lng], { icon }).addTo(map);
    const slug = encodeURIComponent(t.name + "|" + t.place);
    m.bindPopup(`<strong>${escapeHtml(t.name)}</strong><br>${escapeHtml(t.district)} · ${count} inscriptions<br><a href="#/temple/${slug}">View inscriptions →</a>`);
  });
}
function updateSidePanel() {
  const panel = document.getElementById("sidePanel");
  if (!panel || !mapInstance) return;
  const bounds = mapInstance.getBounds();
  const visible = INDEX.temples.filter(t => t.lat && t.lng && bounds.contains([t.lat, t.lng]));
  panel.innerHTML = visible.length
    ? visible.map(t => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><a href="#/temple/${encodeURIComponent(t.name+'|'+t.place)}"><strong>${escapeHtml(t.name)}</strong></a><br><span class="muted">${escapeHtml(t.district)} · ${t.inscriptions.length}</span></div>`).join("")
    : "<p class='muted'>No temples in view.</p>";
}

/* Boot */
initTheme();
loadData().then(route).catch(err => {
  $app().innerHTML = `<p>Could not load data. ${escapeHtml(err.message)}</p>`;
});
