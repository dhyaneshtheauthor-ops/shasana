/* Shasana — redesigned client app */
const DATA = { inscriptions: [], kings: [], temples: [] };
const INDEX = { byKing: {}, temples: [] };
const collapsedBranches = new Set(["First Empire", "Early", "Early Pandya"]);
let mapInstance = null;
let clusterLayer = null;
const CARTO_KEY = "cb1_4vlf_1_e392d35f157b6850d4b0be27";

const $app = () => document.getElementById("app");

async function loadData() {
  const [arie, kings, temples] = await Promise.all([
    fetch("data/arie_1918-1919.json").then(r => r.json()),
    fetch("data/kings.json").then(r => r.json()),
    fetch("data/temples.json").then(r => r.json())
  ]);
  DATA.inscriptions = arie;
  DATA.kings = kings.filter(k => k.king_id);
  DATA.temples = temples;
  buildIndexes();
}

function buildIndexes() {
  INDEX.byKing = {};
  DATA.inscriptions.forEach(ins => {
    const kid = ins.king_identified_id || "unidentified";
    if (!INDEX.byKing[kid]) INDEX.byKing[kid] = [];
    INDEX.byKing[kid].push(ins);
  });

  const byId = new Map();
  DATA.temples.forEach(t => {
    byId.set(t.temple_id, {
      temple_id: t.temple_id,
      name: t.display_name || "Temple",
      name_variants: t.name_variants || "",
      place: t.temple_place || "",
      district: titleCase(t.temple_district || ""),
      lat: t.latitude || null,
      lng: t.longitude || null,
      deity: t.temple_deity || "",
      bio: t.temple_short_bio || "",
      image_url: t.temple_image || "",
      image_attribution: t.image_attribution || "",
      popularity: t.popularity || "",
      inscriptions: [],
      dynasties: new Set()
    });
  });

  DATA.inscriptions.forEach(ins => {
    if (!ins.temple_id || !byId.has(ins.temple_id)) return;
    const t = byId.get(ins.temple_id);
    // Only take the wall/pillar location from ARIE; everything else comes from temples.json
    ins._exact_location = ins.location_within_temple || "";
    t.inscriptions.push(ins);
    if (ins.dynasty_normalized) t.dynasties.add(ins.dynasty_normalized);
  });

  INDEX.temples = Array.from(byId.values())
    .filter(t => t.inscriptions.length > 0)
    .sort((a, b) => b.inscriptions.length - a.inscriptions.length);
}

function titleCase(s) { return (s || "").replace(/\b\w/g, c => c.toUpperCase()); }
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));
}
function expandCenturies(raw) {
  if (!raw) return [];
  const s = String(raw).toLowerCase();
  const nums = [...s.matchAll(/(\d+)(?:st|nd|rd|th)?/g)].map(m => parseInt(m[1], 10));
  if (nums.length >= 2) {
    const out = [];
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) out.push(n + "th century");
    return out;
  }
  if (nums.length === 1) return [nums[0] + "th century"];
  return [raw];
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
  const years = new Set(DATA.inscriptions.map(i => i.arie_year).filter(Boolean)).size;
  $app().innerHTML = `
    <section class="hero" style="min-height:60vh;padding:80px 20px 40px;text-align:center">
      <h2 id="heroText" style="font-size:clamp(2rem,5vw,3.2rem);max-width:720px;margin:0 auto 16px;font-weight:600"></h2>
      <p class="muted" style="max-width:560px;margin:0 auto 24px;font-size:1.1rem">Search temples, kings and dynasties across Tamil Nadu. Open any pin to see the temple and the king behind it.</p>
      <a href="#/map" class="btn" style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:8px;background:var(--gold);color:#1C1A18;font-weight:600;text-decoration:none">Open the interactive map →</a>
      <p class="muted" style="margin-top:12px;font-size:.9rem">${totalInsc} inscriptions across ${totalTemples} temples and ${totalKings} kings</p>
    </section>

    <div class="stats">
      <div class="stat"><div class="num">${totalInsc}</div><div class="lbl">Inscriptions</div></div>
      <div class="stat"><div class="num">${totalTemples}</div><div class="lbl">Temples</div></div>
      <div class="stat"><div class="num">${totalKings}</div><div class="lbl">Kings</div></div>
      <div class="stat"><div class="num">${years}</div><div class="lbl">ARIE years</div></div>
    </div>

    <section style="padding:40px 0">
      <h3 class="section-title">Find the record, the temple and the king together</h3>
      <div class="grid" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
        <div class="card" style="padding:24px"><h3 style="margin:0 0 8px">Find any temple fast</h3><p class="muted">Click a pin to see its king and period.</p></div>
        <div class="card" style="padding:24px"><h3 style="margin:0 0 8px">Trace a dynasty</h3><p class="muted">Chola and Pandya lists sit side by side, so you can compare reigns.</p></div>
        <div class="card" style="padding:24px"><h3 style="margin:0 0 8px">Know the king behind the record</h3><p class="muted">Each ruler page links to the temples tied to that king.</p></div>
        <div class="card" style="padding:24px"><h3 style="margin:0 0 8px">Browse by place</h3><p class="muted">Start from a district or a temple town you already know.</p></div>
      </div>
    </section>

    <section style="padding:40px 0">
      <h3 class="section-title">How it works</h3>
      <div class="grid" style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
        <div class="card" style="padding:24px"><span class="muted" style="font-size:.8rem;font-weight:600">STEP 1</span><h3 style="margin:8px 0">Open the map</h3><p class="muted">Pick a region or search a temple name.</p></div>
        <div class="card" style="padding:24px"><span class="muted" style="font-size:.8rem;font-weight:600">STEP 2</span><h3 style="margin:8px 0">Choose a temple or a king</h3><p class="muted">Details open beside the map.</p></div>
        <div class="card" style="padding:24px"><span class="muted" style="font-size:.8rem;font-weight:600">STEP 3</span><h3 style="margin:8px 0">Follow the links</h3><p class="muted">Jump to related temples, rulers and dynastic lists.</p></div>
      </div>
    </section>

    <section style="padding:40px 0">
      <h3 class="section-title">Questions people ask</h3>
      <div style="max-width:720px">
        <details class="card" style="padding:16px 20px;margin-bottom:8px"><summary style="cursor:pointer;font-weight:600">What does the database cover?</summary><p class="muted" style="margin-top:8px">Chola and Pandya inscriptions. The first release is built from a sample volume of the Annual Report on Indian Epigraphy.</p></details>
        <details class="card" style="padding:16px 20px;margin-bottom:8px"><summary style="cursor:pointer;font-weight:600">Where do the records come from?</summary><p class="muted" style="margin-top:8px">They are indexed from the Annual Report on Indian Epigraphy (ARIE). More volumes will be added over time.</p></details>
        <details class="card" style="padding:16px 20px;margin-bottom:8px"><summary style="cursor:pointer;font-weight:600">Is this a finished database?</summary><p class="muted" style="margin-top:8px">No. This is a preliminary version. The map, the counts and the dynastic lists are still being built.</p></details>
        <details class="card" style="padding:16px 20px;margin-bottom:8px"><summary style="cursor:pointer;font-weight:600">Do I need an account?</summary><p class="muted" style="margin-top:8px">No. You can open the map and every record without signing in.</p></details>
      </div>
    </section>

    <section style="text-align:center;padding:40px 0">
      <div class="card" style="padding:40px 24px;max-width:640px;margin:0 auto">
        <h3 style="margin:0 0 12px">Start with the map</h3>
        <p class="muted">Pick a temple, meet the king, and read what was recorded.</p>
        <a href="#/map" class="btn" style="display:inline-block;margin-top:16px;padding:12px 20px;border-radius:8px;background:var(--gold);color:#1C1A18;font-weight:600;text-decoration:none">Open the interactive map →</a>
      </div>
    </section>
  `;
  typewriter("heroText", "Every Chola and Pandya inscription, placed on one map");
}

function templeCard(t) {
  const slug = encodeURIComponent(t.name + "|" + t.place);
  const letter = (t.name || "?").charAt(0);
  const dots = [...t.dynasties].map(d => `<span class="dot dot-${d.toLowerCase()}"></span>`).join("");
  const img = t.image_url
    ? `<img src="${escapeHtml(t.image_url)}" alt="" class="card-img" loading="lazy">`
    : placeholder(letter);
  return `<a href="#/temple/${slug}" class="card temple-card" style="text-decoration:none;color:inherit">
    <div class="overlay">${img}<h3>${escapeHtml(t.name)}</h3></div>
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
        <option value="popularity">Popularity</option>
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
    if (q) list = list.filter(t => templeMatches(t, q));
    if (sort.value === "az") list.sort((a,b) => a.name.localeCompare(b.name));
    else if (sort.value === "count") list.sort((a,b) => b.inscriptions.length - a.inscriptions.length);
    else list.sort(byPopularity);
    grid.innerHTML = list.map(t => templeCard(t)).join("");
  }
  search.addEventListener("input", update);
  sort.addEventListener("change", update);
  update();
}
function renderTemple(key) {
  const [name, place] = decodeURIComponent(key).split("|");
  const t = INDEX.temples.find(x => x.name === name && x.place === (place||""));
  if (!t) { $app().innerHTML = "<p>Temple not found.</p>"; return; }
  const dates = t.inscriptions.map(i => i.date_identified).filter(Boolean);
  const banner = t.image_url
    ? `<div class="temple-banner" style="background-image:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.7)),url('${escapeHtml(t.image_url)}')">
         <h2>${escapeHtml(t.name)}</h2>
       </div>`
    : `<h2 style="margin:16px 0 4px">${escapeHtml(t.name)}</h2>`;
  $app().innerHTML = `
    <p><a href="#/temples">← Temples</a></p>
    ${banner}
    <p class="muted" style="margin:8px 0">${escapeHtml(t.place)}${t.district ? " · " + escapeHtml(t.district) : ""}</p>
    ${t.deity ? `<p><strong>Deity:</strong> ${escapeHtml(t.deity)}</p>` : ""}
    ${t.bio ? `<p style="max-width:720px;margin:8px 0 16px">${escapeHtml(t.bio)}</p>` : ""}
    <div class="stats">
      <div class="stat"><div class="num">${t.inscriptions.length}</div><div class="lbl">Inscriptions</div></div>
      <div class="stat"><div class="num">${dates.length ? dates[0] : "—"}</div><div class="lbl">Earliest</div></div>
      <div class="stat"><div class="num">${dates.length ? dates[dates.length-1] : "—"}</div><div class="lbl">Latest</div></div>
      <div class="stat"><div class="num">${new Set(t.inscriptions.map(i=>i.king_identified_id).filter(Boolean)).size}</div><div class="lbl">Kings</div></div>
    </div>
    <h3 class="section-title">Inscriptions</h3>
    ${t.inscriptions.map(ins => inscCard(ins)).join("")}
  `;
}

function byPopularity(a, b) {
  const rank = { high: 3, medium: 2, low: 1, "": 0 };
  const ra = rank[(a.popularity||"").toLowerCase()] || 0;
  const rb = rank[(b.popularity||"").toLowerCase()] || 0;
  if (rb !== ra) return rb - ra;
  return b.inscriptions.length - a.inscriptions.length;
}

function templeMatches(t, q) {
  const blob = [t.name, t.name_variants, t.place, t.district, t.deity].join(" ").toLowerCase();
  return blob.includes(q);
}


function inscCard(ins) {
  const dyn = (ins.dynasty_normalized || "").toLowerCase();
  const note = ins.SII_notes || ins.remarks || "";
  const loc = ins.location_within_temple || "";
  const typeCls = ins.record_type === "copper" ? "tag-chola" : "tag-pandya";
  const logo = dyn === "chola"
    ? `<img src="images/icons/chola_emblem.png" alt="" class="insc-logo">`
    : dyn === "pandya"
    ? `<img src="images/icons/pandya_emblem.png" alt="" class="insc-logo">`
    : "";
  return `<a href="#/inscription/${encodeURIComponent(ins.arie_id)}" class="insc-card ${dyn}">
    <div class="insc-header">
      <div class="insc-meta">
        <span class="are-badge">${escapeHtml(ins.arie_no || ins.arie_id)}</span>
        <span class="tag ${typeCls}" style="margin-left:6px">${escapeHtml(ins.record_type || "stone")}</span>
        <span class="muted" style="margin-left:8px">${formatDate(ins.date_raw, ins.date_identified)}</span>
        <h4>${ins.king_identified_id ? escapeHtml(ins.king || "Unnamed king") : escapeHtml(ins.king || "Unnamed king")}</h4>
      </div>
      ${logo}
    </div>
    ${loc ? `<p class="muted" style="margin:0 0 6px">${escapeHtml(loc)}</p>` : ""}
    <p class="muted" style="margin:0">${escapeHtml(note.slice(0, 160))}</p>
  </a>`;
}

/* KINGS */
function renderKings() {
  const allKings = DATA.kings.filter(k => k.accession_year_ce);
  if (!allKings.length) {
    $app().innerHTML = "<p>No kings with dates found.</p>";
    return;
  }
  const minY = Math.min(...allKings.map(k => k.accession_year_ce));
  const maxY = Math.max(...allKings.map(k => k.end_year_ce || k.accession_year_ce));

  // Segment timeline into 50-year buckets for local expansion
  const SEGMENT = 50;
  const segments = [];
  for (let y = Math.floor(minY / SEGMENT) * SEGMENT; y <= maxY + SEGMENT; y += SEGMENT) {
    segments.push({ start: y, end: y + SEGMENT, kings: [] });
  }

  function assignToSegments(kings) {
    kings.forEach(k => {
      const start = k.accession_year_ce;
      const seg = segments.find(s => start >= s.start && start < s.end);
      if (seg) seg.kings.push(k);
    });
  }

  const cholaKings = allKings.filter(k => k.dynasty === "Chola").sort((a, b) => a.accession_year_ce - b.accession_year_ce);
  const pandyaKings = allKings.filter(k => k.dynasty === "Pandya").sort((a, b) => a.accession_year_ce - b.accession_year_ce);

  // Reset segments and assign
  segments.forEach(s => s.kings = []);
  assignToSegments(cholaKings);
  assignToSegments(pandyaKings);

  // Compute cumulative Y positions with expansion where dense
  const CARD_MIN_H = 118;
  const GAP = 12;
  const HEADER_OFFSET = 60;
  let cumulative = HEADER_OFFSET;
  const yearToY = new Map();

  segments.forEach(seg => {
    const count = seg.kings.length;
    // Base height for 50 years, expand if many kings
    const baseH = 80;
    const needed = Math.max(baseH, count * (CARD_MIN_H + GAP) * 0.7); // allow some packing
    seg.top = cumulative;
    seg.height = needed;
    cumulative += needed;
    // Map years in segment
    for (let yy = seg.start; yy < seg.end; yy += 10) {
      const frac = (yy - seg.start) / SEGMENT;
      yearToY.set(yy, seg.top + frac * seg.height);
    }
    yearToY.set(seg.end, seg.top + seg.height);
  });

  const totalHeight = cumulative + 40;

  function getY(year) {
    // Find closest mapped or interpolate
    const rounded = Math.round(year / 10) * 10;
    if (yearToY.has(rounded)) return yearToY.get(rounded);
    // fallback linear
    const frac = (year - minY) / Math.max(1, maxY - minY);
    return HEADER_OFFSET + frac * (totalHeight - HEADER_OFFSET - 40);
  }

  function layoutKings(kings) {
    const items = [];
    // Group by approximate position to avoid exact overlaps
    const placed = [];
    kings.forEach(k => {
      let y = getY(k.accession_year_ce);
      // Nudge down if too close to previous in same lane
      const last = placed[placed.length - 1];
      if (last && y < last.bottom + GAP) {
        y = last.bottom + GAP;
      }
      const cardH = CARD_MIN_H;
      items.push({ king: k, top: y, height: cardH });
      placed.push({ top: y, bottom: y + cardH });
    });
    return items;
  }

  const cholaItems = layoutKings(cholaKings);
  const pandyaItems = layoutKings(pandyaKings);

  function renderCards(items, dyn) {
    return items.map(it => {
      const k = it.king;
      const years = (k.accession_year_ce && k.end_year_ce)
        ? `${k.accession_year_ce}–${k.end_year_ce} CE`
        : (k.century || "");
      const count = (INDEX.byKing[k.king_id] || []).length;
      const bio = k.short_bio
        ? `<div class="bio">${escapeHtml(k.short_bio.slice(0, 140))}</div>`
        : "";
      const branch = k.dynasty_branch ? `<span class="meta">${escapeHtml(k.dynasty_branch)}</span>` : "";
      const subCls = k.ruling_status === "subsidiary" ? " sub" : "";
      return `<a href="#/king/${k.king_id}" class="dyn-card ${dyn.toLowerCase()}${subCls} reveal" style="top:${it.top}px;min-height:${it.height}px" data-year="${k.accession_year_ce}">
        <h3>${escapeHtml(k.king_name_standard)}</h3>
        <div class="years">${escapeHtml(years)}${count ? ` · ${count} insc` : ""}</div>
        ${branch}
        ${bio}
      </a>`;
    }).join("");
  }

  // Year marks every 50 years, positioned by getY
  const yearMarks = [];
  for (let y = Math.ceil(minY / 50) * 50; y <= maxY; y += 50) {
    const pos = getY(y);
    yearMarks.push(`<div class="dyn-year-label" style="top:${pos}px">${y}</div>`);
  }

  $app().innerHTML = `
    <div class="dyn-page">
      <h2>Dynasties</h2>
      <div class="dyn-switch">
        <button class="active" data-mode="both">Both</button>
        <button data-mode="chola">Chola</button>
        <button data-mode="pandya">Pandya</button>
      </div>
      <div class="dyn-timeline-wrap" id="dynWrap">
        <div class="dyn-timeline" id="dynTl" style="height:${totalHeight}px">
          <div class="dyn-lane">
            <div class="dyn-lane-header chola"><img src="images/icons/chola_emblem.png" alt="" width="28" height="28"> Chola</div>
            ${renderCards(cholaItems, "Chola")}
          </div>
          <div class="dyn-axis" style="height:${totalHeight}px">
            <div class="dyn-axis-line"></div>
            ${yearMarks.join("")}
          </div>
          <div class="dyn-lane">
            <div class="dyn-lane-header pandya"><img src="images/icons/pandya_emblem.png" alt="" width="28" height="28"> Pandya</div>
            ${renderCards(pandyaItems, "Pandya")}
          </div>
        </div>
      </div>
    </div>
  `;

  // Switch buttons
  document.querySelectorAll(".dyn-switch button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dyn-switch button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mode;
      const lanes = document.querySelectorAll(".dyn-lane");
      lanes[0].style.display = (mode === "pandya") ? "none" : "";
      lanes[1].style.display = (mode === "chola") ? "none" : "";
      document.getElementById("dynTl").classList.toggle("single", mode !== "both");
    });
  });

  // Reveal on scroll, and reverse when leaving upwards
  const wrap = document.getElementById("dynWrap");
  const cards = document.querySelectorAll(".dyn-card.reveal");
  if ("IntersectionObserver" in window && wrap) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
        } else if (e.boundingClientRect.top < 0) {
          // scrolled out upwards — reverse animation
          e.target.classList.remove("in");
        }
      });
    }, { root: wrap, threshold: 0.15, rootMargin: "0px 0px -10% 0px" });
    cards.forEach(c => io.observe(c));
  } else {
    cards.forEach(c => c.classList.add("in"));
  }

  // Open scrolled to ~800 CE
  setTimeout(() => {
    const targetY = getY(800);
    const viewH = wrap ? wrap.clientHeight : 600;
    wrap.scrollTop = Math.max(0, targetY - viewH * 0.35);
  }, 50);
}

function kingCard(k) {
  const years = (k.accession_year_ce && k.end_year_ce) ? `${k.accession_year_ce}–${k.end_year_ce}` : (k.century||"");
  const count = (INDEX.byKing[k.king_id]||[]).length;
  const img = k.image
    ? `<img src="${escapeHtml(k.image)}" alt="" style="width:64px;height:80px;object-fit:cover;border-radius:8px;margin-right:12px">`
    : "";
  return `<a href="#/king/${k.king_id}" id="k-${k.king_id}" class="card" style="display:block;text-decoration:none;color:inherit;margin-bottom:12px;padding:16px">
    <div style="display:flex;align-items:flex-start">
      ${img}
      <div style="flex:1">
        <span class="tag tag-pandya">${escapeHtml(k.dynasty_branch||"Pandya")}</span>
        <h3 style="margin:6px 0 4px">${escapeHtml(k.king_name_standard)}</h3>
        <p class="muted">${escapeHtml(years)}</p>
        <p>${escapeHtml((k.short_bio||"").slice(0,140))}</p>
        ${count ? `<span class="badge">${count} inscriptions</span>` : ""}
      </div>
    </div>
  </a>`;
}

function renderKing(id) {
  const k = DATA.kings.find(x => x.king_id === id);
  if (!k) { $app().innerHTML = "<p>King not found.</p>"; return; }
  const insc = INDEX.byKing[id] || [];
  const years = (k.accession_year_ce && k.end_year_ce) ? `${k.accession_year_ce}–${k.end_year_ce} CE` : (k.century || "");
  const dynastyLabel = [k.dynasty_branch, k.dynasty].filter(Boolean).join(" ");
  const dynastyKings = DATA.kings.filter(x => x.dynasty === k.dynasty && x.accession_year_ce).sort((a, b) => a.accession_year_ce - b.accession_year_ce);
  const idx = dynastyKings.findIndex(x => x.king_id === id);
  const prev = idx > 0 ? dynastyKings[idx - 1] : null;
  const next = idx >= 0 && idx < dynastyKings.length - 1 ? dynastyKings[idx + 1] : null;
  const portrait = k.image ? `<img src="${escapeHtml(k.image)}" alt="${escapeHtml(k.king_name_standard)}" class="portrait">` : "";
  const districts = [...new Set(insc.map(i => {
    const t = INDEX.temples.find(x => x.temple_id === i.temple_id);
    return t ? t.district : null;
  }).filter(Boolean))].sort();
  $app().innerHTML = `
    <div class="king-page">
      <aside class="king-sidebar">
        ${portrait}
        <h2>${escapeHtml(k.king_name_standard)}</h2>
        <p class="muted">${escapeHtml(years)}</p>
        ${dynastyLabel ? `<p class="muted">${escapeHtml(dynastyLabel)}</p>` : ""}
        ${k.short_bio ? `<p style="margin:16px 0;text-align:left">${escapeHtml(k.short_bio)}</p>` : ""}
        <div style="text-align:center"><a href="#/map?king=${encodeURIComponent(k.king_id)}" class="btn" style="display:inline-flex;align-items:center;gap:8px;margin-top:12px;min-height:44px">See on map</a></div>
      </aside>
      <div class="king-insc-col">
        <h3>Inscriptions (${insc.length})</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
          <input type="search" id="kSearch" placeholder="Search…" style="flex:1;min-width:160px;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
          <select id="kDistrict" style="padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
            <option value="">All districts</option>
            ${districts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
          </select>
          <select id="kSort" style="padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text)">
            <option value="">Default</option>
            <option value="date">By date</option>
            <option value="arie">By ARIE number</option>
          </select>
        </div>
        <div id="kInscList">${insc.map(ins => inscCard(ins)).join("") || `<p class="muted">No inscriptions linked.</p>`}</div>
      </div>
    </div>
    <div class="king-nav-cards">
      ${prev ? `<a href="#/king/${prev.king_id}">← ${escapeHtml(prev.king_name_standard)}</a>` : `<div></div>`}
      ${next ? `<a href="#/king/${next.king_id}" style="text-align:right">${escapeHtml(next.king_name_standard)} →</a>` : `<div></div>`}
    </div>
  `;
  const search = document.getElementById("kSearch");
  const dist = document.getElementById("kDistrict");
  const sort = document.getElementById("kSort");
  const list = document.getElementById("kInscList");
  function update() {
    const q = search.value.toLowerCase();
    const d = dist.value;
    let filtered = insc.filter(ins => {
      if (d) {
        const t = INDEX.temples.find(x => x.temple_id === ins.temple_id);
        if (!t || t.district !== d) return false;
      }
      if (q) {
        const t = INDEX.temples.find(x => x.temple_id === ins.temple_id);
        const blob = [ins.arie_no, ins.king, ins.location_within_temple, ins.date_raw, ins.date_identified, ins.remarks, ins.SII_notes, t ? t.name + " " + t.place + " " + t.district : ""].join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    if (sort.value === "date") filtered.sort((a, b) => (a.date_identified || "").localeCompare(b.date_identified || ""));
    if (sort.value === "arie") filtered.sort((a, b) => (a.arie_no || "").localeCompare(b.arie_no || ""));
    list.innerHTML = filtered.map(ins => inscCard(ins)).join("") || `<p class="muted">No matches.</p>`;
  }
  search.addEventListener("input", update);
  dist.addEventListener("change", update);
  sort.addEventListener("change", update);
}

function initKingMiniMap(temples) {
  const el = document.getElementById("kingMiniMap");
  if (!el || !window.L) return;
  const m = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }).fitBounds(temples.map(t => [t.lat, t.lng]));
  const theme = document.documentElement.getAttribute("data-theme");
  const style = theme === "dark" ? "dark_all" : "light_all";
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${CARTO_KEY}`, { maxZoom: 12 }).addTo(m);
  temples.forEach(t => L.circleMarker([t.lat, t.lng], { radius: 6, color: "#C99A3B", fillOpacity: .9 }).addTo(m));
}

/* INSCRIPTION */
function renderInscription(id) {
  const ins = DATA.inscriptions.find(x => x.arie_id === id);
  if (!ins) { $app().innerHTML = "<p>Inscription not found.</p>"; return; }
  const king = DATA.kings.find(k => k.king_id === ins.king_identified_id);
  const kingName = king ? king.king_name_standard : (ins.king || "Unnamed king");
  const kingLink = ins.king_identified_id ? `<a href="#/king/${ins.king_identified_id}">${escapeHtml(kingName)}</a>` : escapeHtml(kingName);
  let tentative = "";
  if (ins.king_tentative_ids) {
    const ids = String(ins.king_tentative_ids).split(",").map(s => s.trim()).filter(Boolean);
    const links = ids.map(id => {
      const k = DATA.kings.find(x => x.king_id === id);
      return k ? `<a href="#/king/${id}">${escapeHtml(k.king_name_standard)}</a>` : id;
    });
    if (links.length) tentative = `<p class="muted">Might be ${links.join(" or ")}</p>`;
  }
  const note = ins.SII_notes || ins.remarks || "No summary available.";
  const citation = [ins.ARIE_citation, ins.SII_citation ? "SII " + ins.SII_citation : ""].filter(Boolean).join(" · ");
  const hasSII = ins.SII_status === "yes" && (ins.SII_contents || ins.SII_translation);
  const textBlock = hasSII ? `
    <div class="sii-tabs">
      <button class="chip active" data-tab="trans">Translation</button>
      <button class="chip" data-tab="orig">Original</button>
    </div>
    <div id="siiTrans" class="insc-card" style="white-space:pre-wrap">${escapeHtml(ins.SII_translation || "")}</div>
    <div id="siiOrig" class="insc-card" style="white-space:pre-wrap;display:none">${escapeHtml(ins.SII_contents || "")}</div>
  ` : "";
  $app().innerHTML = `
    <p><a href="#/">← Home</a></p>
    <span class="tag tag-${(ins.dynasty_normalized||"pandya").toLowerCase()}">${escapeHtml(ins.dynasty_normalized || "")}</span>
    <h2>${escapeHtml(ins.arie_no || ins.arie_id)}</h2>
    <p class="muted">${escapeHtml(ins.location_within_temple || "")}</p>
    <p class="muted">${escapeHtml(citation)}</p>
    <div class="stats">
      <div class="stat"><div class="lbl">King</div><div>${kingLink}</div></div>
      <div class="stat"><div class="lbl">Date</div><div>${formatDate(ins.date_raw, ins.date_identified)}</div></div>
      <div class="stat"><div class="lbl">Language</div><div>${escapeHtml(ins.language || "—")}</div></div>
      <div class="stat"><div class="lbl">Type</div><div>${escapeHtml(ins.record_type || "stone")}</div></div>
    </div>
    ${tentative}
    <div class="insc-card">${escapeHtml(note)}</div>
    ${textBlock}
  `;
  if (hasSII) {
    document.querySelectorAll(".sii-tabs .chip").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".sii-tabs .chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("siiTrans").style.display = btn.dataset.tab === "trans" ? "" : "none";
        document.getElementById("siiOrig").style.display = btn.dataset.tab === "orig" ? "" : "none";
      });
    });
  }
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
  const seenTemples = new Set();
  INDEX.temples.forEach(t => {
    if (templeMatches(t, s)) {
      out.push({ html: templeCard(t) });
      seenTemples.add(t.temple_id);
    }
  });
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
let mapMarkers = [];
let selectedMarker = null;
let currentFilters = { q: "", dyn: "", king: "", cen: "", year: "" };

function getFilteredInscriptions(t) {
  return t.inscriptions.filter(i => {
    if (currentFilters.dyn && i.dynasty_normalized !== currentFilters.dyn) return false;
    if (currentFilters.king && i.king_identified_id !== currentFilters.king) return false;
    if (currentFilters.cen && !expandCenturies(i.century).includes(currentFilters.cen)) return false;
    if (currentFilters.year && !String(i.arie_year || "").includes(currentFilters.year)) return false;
    return true;
  });
}

function renderMap() {
  const kingsWithInsc = DATA.kings.filter(k => (INDEX.byKing[k.king_id] || []).length > 0);
  const kings = kingsWithInsc.map(k => `<option value="${escapeHtml(k.king_id)}">${escapeHtml(k.king_name_standard)}</option>`).join("");
  const centurySet = new Set();
  DATA.inscriptions.forEach(i => expandCenturies(i.century).forEach(c => centurySet.add(c)));
  const centuries = [...centurySet].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
  const years = [...new Set(DATA.inscriptions.map(i => String(i.arie_year || "").split("-")[0]).filter(Boolean))].sort();
  const timeline = `<button class="tl-dot" data-cen="" title="All">All</button>` + centuries.map(c => {
    const label = c.replace("th century", "00s").replace("st century", "00s");
    return `<button class="tl-dot" data-cen="${escapeHtml(c)}" title="${escapeHtml(c)}">${label}</button>`;
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const kingParam = params.get("king");
  if (kingParam && DATA.kings.some(k => k.king_id === kingParam)) {
    currentFilters.king = kingParam;
    document.getElementById("mapKing").value = kingParam;
    setTimeout(() => { refreshMarkers(); }, 100);
  }
  }).join("");
  $app().innerHTML = `
    <div class="map-page">
      <div id="map"></div>
      <div class="map-overlays">
        <div style="position:relative;flex:1;min-width:380px;max-width:500px">
          <input type="search" id="mapSearch" placeholder="Search temple, king, place…" class="map-search" autocomplete="off">
          <div id="searchSuggest" class="search-suggest" style="display:none;position:absolute;top:100%;left:0;z-index:600;min-width:280px;margin-top:4px"></div>
        </div>
        <select id="mapDynasty"><option value="">All dynasties</option><option value="Pandya">Pandya</option><option value="Chola">Chola</option></select>
        <select id="mapKing"><option value="">All kings</option>${kings}</select>
        <select id="mapCentury"><option value="">All centuries</option>${centuries.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}</select>
        <select id="mapYear"><option value="">All ARIE years</option>${years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("")}</select>
      </div>
      <div id="pinCard" class="pin-card" style="display:none"></div>
      <div class="timeline-bar" id="timelineBar">${timeline}</div>
    </div>
    `;
  initFullMap();
  document.getElementById("mapSearch").addEventListener("input", onSearchInput);
  document.getElementById("mapDynasty").addEventListener("change", applyFilters);
  document.getElementById("mapKing").addEventListener("change", applyFilters);
  document.getElementById("mapCentury").addEventListener("change", applyFilters);
  document.getElementById("mapYear").addEventListener("change", applyFilters);
  document.querySelectorAll(".tl-dot").forEach(btn => {
    btn.addEventListener("click", () => {
      currentFilters.cen = btn.dataset.cen || "";
      document.getElementById("mapCentury").value = btn.dataset.cen || "";
      document.querySelectorAll(".tl-dot").forEach(b => b.classList.toggle("active", b === btn));
      refreshMarkers();
    });
  });
}

function onSearchInput(e) {
  const q = e.target.value.toLowerCase().trim();
  currentFilters.q = q;
  // Clear other filters when a new search is typed
  currentFilters.dyn = "";
  currentFilters.king = "";
  currentFilters.cen = "";
  currentFilters.year = "";
  document.getElementById("mapDynasty").value = "";
  document.getElementById("mapKing").value = "";
  document.getElementById("mapCentury").value = "";
  document.getElementById("mapYear").value = "";
  showSuggestions(q);
  refreshMarkers();
}

function showSuggestions(q) {
  const box = document.getElementById("searchSuggest");
  if (!q) { box.style.display = "none"; return; }
  const results = [];
  INDEX.temples.forEach(t => {
    if (templeMatches(t, q))
      results.push({
        type: "Temple",
        label: t.name + (t.place ? " · " + t.place : ""), 
        action: () => {
          document.getElementById("mapSearch").value = t.name;
          currentFilters.q = t.name.toLowerCase();
          box.style.display = "none";
          refreshMarkers();
          showTempleCard(t, null);
        }
      });
  });
  DATA.kings.forEach(k => {
    if ((INDEX.byKing[k.king_id] || []).length && (k.king_name_standard || "").toLowerCase().includes(q))
      results.push({ 
        type: "King",
        label: k.king_name_standard, 
        action: () => {
          document.getElementById("mapKing").value = k.king_id;
          applyFilters();
          box.style.display = "none";
          showKingCard(k.king_id);
        }      
      });
  });
  const districts = new Set(INDEX.temples.map(t => t.district).filter(Boolean));
  districts.forEach(d => {
    if (d.toLowerCase().includes(q))
      results.push({ type: "District", label: d, action: () => { document.getElementById("mapSearch").value = d; currentFilters.q = d.toLowerCase(); box.style.display = "none"; refreshMarkers(); } });
  });
  DATA.inscriptions.forEach(ins => {
    if ((ins.arie_no || "").toLowerCase().includes(q)) {
      const t = INDEX.temples.find(x => x.temple_id === ins.temple_id);
      if (t) results.push({
        type: "Inscription",
        label: ins.arie_no + " · " + (t.name || ""),
        action: () => {
          document.getElementById("mapSearch").value = ins.arie_no;
          currentFilters.q = "";
          box.style.display = "none";
          refreshMarkers();
          showInscriptionCard(ins);
        }
      });
    }
  });
  box.innerHTML = results.slice(0, 8).map((r, i) => `<div class="suggest-item" data-i="${i}"><span class="suggest-type">${r.type}</span> ${escapeHtml(r.label)}</div>`).join("") || `<div class="suggest-item muted">No matches</div>`;
  box.style.display = "block";
  box.querySelectorAll(".suggest-item").forEach((el, i) => {
    if (results[i]) el.addEventListener("click", results[i].action);
  });
}

function applyFilters() {
  currentFilters.dyn = document.getElementById("mapDynasty").value;
  currentFilters.king = document.getElementById("mapKing").value;
  currentFilters.cen = document.getElementById("mapCentury").value;
  currentFilters.year = document.getElementById("mapYear").value;
  document.querySelectorAll(".tl-dot").forEach(b => b.classList.toggle("active", b.dataset.cen === currentFilters.cen));
  refreshMarkers();
}

function initMiniMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const el = document.getElementById("homeMap");
  if (!el) return;
  mapInstance = L.map(el).setView([10.5, 78.5], 6);
  updateMapTiles();
  INDEX.temples.filter(t => t.lat && t.lng).slice(0, 12).forEach(t => {
    const count = t.inscriptions.length;
    const size = Math.min(48, Math.max(24, 18 + count * 2));
    const icon = L.divIcon({
      className: "",
      html: `<div class="map-pin" style="width:${size}px;height:${size}px">${count}</div>`,
      iconSize: [size, size], iconAnchor: [size/2, size/2]
    });
    const m = L.marker([t.lat, t.lng], { icon }).addTo(mapInstance);
    m.on("click", () => {
      location.hash = "#/map";
      setTimeout(() => showTempleCard(t, null), 300);
    });
  });
}

function initFullMap() {
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  mapInstance = L.map("map").setView([10.5, 78.5], 7);
  updateMapTiles();
  refreshMarkers();
  mapInstance.on("moveend", updateSidePanel);
  mapInstance.on("zoomend", refreshMarkers);
}

function refreshMarkers() {
  if (!mapInstance) return;
  if (clusterLayer) { mapInstance.removeLayer(clusterLayer); clusterLayer = null; }
  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];
  const points = [];
  INDEX.temples.forEach(t => {
    if (!t.lat || !t.lng) return;
    if (currentFilters.q && !templeMatches(t, currentFilters.q)) return;
    const filtered = getFilteredInscriptions(t);
    if (filtered.length === 0) return;
    points.push({ t, count: filtered.length, pandya: filtered.filter(i => i.dynasty_normalized === "Pandya").length });
  });
  // Simple grid cluster when zoomed out
  const zoom = mapInstance.getZoom();
  if (zoom < 8 && points.length > 8) {
    const grid = {};
    const cell = zoom < 6 ? 1.5 : 0.8;
    points.forEach(p => {
      const key = Math.floor(p.t.lat / cell) + "," + Math.floor(p.t.lng / cell);
      if (!grid[key]) grid[key] = [];
      grid[key].push(p);
    });
    Object.values(grid).forEach(group => {
      const total = group.reduce((s, p) => s + p.count, 0);
      const lat = group.reduce((s, p) => s + p.t.lat, 0) / group.length;
      const lng = group.reduce((s, p) => s + p.t.lng, 0) / group.length;
      const size = Math.min(64, 28 + total);
      const pandya = group.reduce((s, p) => s + p.pandya, 0);
      const pct = total ? Math.round((pandya / total) * 100) : 0;
      const bg = `conic-gradient(#3F7D6E 0 ${pct}%, #A3301F ${pct}% 100%)`;
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-pin" style="width:${size}px;height:${size}px;background:${bg}">${total}</div>`,
        iconSize: [size, size], iconAnchor: [size/2, size/2]
      });
      const m = L.marker([lat, lng], { icon }).addTo(mapInstance);
      m.on("click", () => showClusterCard(group));
      mapMarkers.push(m);
    });
  } else {
    points.forEach(p => {
      const size = Math.min(56, Math.max(28, 20 + p.count * 2));
      const pct = p.count ? Math.round((p.pandya / p.count) * 100) : 0;
      const bg = `conic-gradient(#3F7D6E 0 ${pct}%, #A3301F ${pct}% 100%)`;
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-pin" style="width:${size}px;height:${size}px;background:${bg}">${p.count}</div>`,
        iconSize: [size, size], iconAnchor: [size/2, size/2]
      });
      const m = L.marker([p.t.lat, p.t.lng], { icon }).addTo(mapInstance);
      m.on("click", () => showTempleCard(p.t, m));
      mapMarkers.push(m);
    });
  }
}

function showClusterCard(group) {
  const panel = document.getElementById("pinCard");
  if (!panel) return;
  panel.style.display = "block";
  panel.innerHTML = `
    <button onclick="document.getElementById('pinCard').style.display='none'" style="float:right;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem">×</button>
    <h3>${group.length} temples</h3>
    ${group.map(p => `<div class="mini-insc" style="cursor:pointer;padding:8px 0" onclick="showTempleFromCluster('${p.t.temple_id}')">${escapeHtml(p.t.name)} · ${p.count}</div>`).join("")}
  `;
}
window.showTempleFromCluster = function(id) {
  const t = INDEX.temples.find(x => x.temple_id === id);
  if (t) showTempleCard(t, null);
};

function showTempleCard(t, marker) {
  if (selectedMarker && selectedMarker.getElement) selectedMarker.getElement()?.querySelector(".map-pin")?.classList.remove("active");
  selectedMarker = marker;
  if (marker && marker.getElement) marker.getElement()?.querySelector(".map-pin")?.classList.add("active");
  const filtered = getFilteredInscriptions(t);
  const slug = encodeURIComponent(t.name + "|" + t.place);
  const loc = [t.place, t.district].filter(Boolean).join(", ");
  const sample = filtered.slice(0, 4);
  const img = t.image_url ? `<img src="${escapeHtml(t.image_url)}" alt="" class="temple-card-img">` : placeholder(t.name);
  const panel = document.getElementById("pinCard");
  if (!panel) return;
  panel.style.display = "block";
  panel.innerHTML = `
    <button onclick="document.getElementById('pinCard').style.display='none'" style="float:right;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem">×</button>
    ${img}
    <h3>${escapeHtml(t.name)}</h3>
    <p class="muted">${escapeHtml(loc)}</p>
    ${t.bio ? `<p>${escapeHtml(t.bio)}</p>` : ""}
    <p><strong>${filtered.length}</strong> inscriptions</p>
    <div>${sample.map(i => `<div class="mini-insc">${escapeHtml(i.arie_no||"")} · ${escapeHtml(i.king||"")}</div>`).join("")}</div>
    <a href="#/temple/${slug}" class="read-more">Read more →</a>
  `;
}

function updateSidePanel() {
  const panel = document.getElementById("sidePanel");
  if (!panel || selectedMarker) return;
  const bounds = mapInstance?.getBounds();
  if (!bounds) return;
  const visible = INDEX.temples.filter(t => t.lat && t.lng && bounds.contains([t.lat, t.lng]) && getFilteredInscriptions(t).length);
  panel.innerHTML = visible.length
    ? `<p class="muted">${visible.length} temples in view. Click a pin for details.</p>`
    : "<p class='muted'>No temples in view.</p>";
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
function showKingCard(kingId) {
  const k = DATA.kings.find(x => x.king_id === kingId);
  if (!k) return;
  const insc = (INDEX.byKing[kingId] || []).slice(0, 5);
  const panel = document.getElementById("pinCard");
  if (!panel) return;
  panel.style.display = "block";
  panel.innerHTML = `
    <button onclick="document.getElementById('pinCard').style.display='none'" style="float:right;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem">×</button>
    <h3>${escapeHtml(k.king_name_standard)}</h3>
    <p class="muted">${escapeHtml(k.century || "")}</p>
    <p>${escapeHtml((k.short_bio || "").slice(0, 200))}</p>
    <p><strong>${(INDEX.byKing[kingId] || []).length}</strong> inscriptions</p>
    <div>${insc.map(i => `<div class="mini-insc">${escapeHtml(i.arie_no || "")} · ${escapeHtml(i.temple || "")}</div>`).join("")}</div>
    <a href="#/king/${kingId}" class="read-more">View king page →</a>
  `;
}
function showInscriptionCard(ins) {
  const panel = document.getElementById("pinCard");
  if (!panel) return;
  const note = ins.SII_notes || ins.remarks || "";
  const loc = ins.location_within_temple || "";
  panel.style.display = "block";
  panel.innerHTML = `
    <button onclick="document.getElementById('pinCard').style.display='none'" style="float:right;background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem">×</button>
    <span class="are-badge">${escapeHtml(ins.arie_no || "")}</span>
    <h3 style="margin:8px 0">${escapeHtml(ins.king || "Unnamed king")}</h3>
    ${loc ? `<p class="muted">${escapeHtml(loc)}</p>` : ""}
    <p>${escapeHtml(note.slice(0, 220))}</p>
    <a href="#/inscription/${encodeURIComponent(ins.arie_id)}" class="read-more">Read more →</a>
  `;
}

/* Boot */
initTheme();
loadData().then(route).catch(err => {
  $app().innerHTML = `<p>Could not load data. ${escapeHtml(err.message)}</p>`;
});
