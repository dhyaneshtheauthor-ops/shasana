/* Shasana — redesigned client app */
const DATA = { inscriptions: [], kings: [], temples: [] };
const INDEX = { byKing: {}, temples: [] };
const collapsedBranches = new Set(["First Empire", "Early", "Early Pandya"]);
let mapInstance = null;
let clusterLayer = null;
let dynCleanup = null;
let heroCleanup = null;
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
/* Cut a bio at a word boundary so it never stops mid-word, and mark the cut
   with an ellipsis. CSS line-clamping still trims longer labels on narrow cards. */
function clipText(text, max) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const body = (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\-–—]+$/, "");
  return body + "…";
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
  if (dynCleanup) { dynCleanup(); dynCleanup = null; }
  if (heroCleanup) { heroCleanup(); heroCleanup = null; }
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
    <section class="hero-v2">
      <div class="hero-copy">
        <p class="hero-eyebrow">Tamil Nadu · Chola &amp; Pandya records</p>
        <h2 id="heroText"></h2>
        <p class="hero-lede">Search temples, kings and dynasties across Tamil Nadu. Open any pin to see the temple and the king behind it.</p>
        <div class="hero-actions">
          <a href="#/map" class="btn">Open the interactive map <span aria-hidden="true">→</span></a>
          <a href="#/search" class="btn btn-ghost">Search the corpus</a>
        </div>
        <p class="hero-counts">${totalInsc} inscriptions · ${totalTemples} temples · ${totalKings} kings</p>
      </div>

      <figure class="hero-map" id="heroMap">
        <div class="hero-map-frame" tabindex="0" role="button" aria-label="Map of Tamil Nadu carrying an inscription; activate to read the translation">
          <div class="hero-map-mount"></div>
          <p class="hero-map-hint" aria-hidden="true">Hover · tap to translate</p>
        </div>
        <figcaption class="hero-map-cap">Tanjavur · 29th regnal year of Rajaraja I</figcaption>
        <p class="sr-only" id="heroMapAlt"></p>
      </figure>
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
  /* Reserve the headline's final height before typing, so the copy column
     does not jump while the line fills in. */
  const headline = "Every Chola and Pandya inscription, placed on one map";
  const h2 = document.getElementById("heroText");
  if (h2 && h2.parentNode) {
    const probe = h2.cloneNode(false);
    probe.removeAttribute("id");
    probe.style.minHeight = "0";
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.style.left = "0";
    probe.style.top = "0";
    probe.style.width = h2.getBoundingClientRect().width + "px";
    probe.textContent = headline;
    h2.parentNode.appendChild(probe);
    h2.style.minHeight = Math.ceil(probe.getBoundingClientRect().height) + "px";
    probe.remove();
  }
  typewriter("heroText", headline);
  initHeroMap();
  renderHeroIntro();
}

/* HOME HERO — scroll-reveal intro block ----------------------------------------- */

const INTRO_TEXT = "Chola and Pandya kings recorded land grants, temple gifts and village rules on temple walls. Now you can read them from one place.";

function renderHeroIntro() {
  const app = $app();
  if (!app) return;
  // Insert intro block after the hero-map figure, before the stats.
  const heroMapFig = app.querySelector("figure.hero-map");
  if (!heroMapFig) return;

  const words = INTRO_TEXT.split(/\s+/).filter(Boolean);
  const wordSpans = words.map(w => `<span class="word">${escapeHtml(w)}</span>`).join(" ");

  const intro = document.createElement("section");
  intro.className = "hero-intro";
  intro.id = "heroIntro";
  intro.innerHTML = `<h3>${wordSpans}</h3>`;
  heroMapFig.after(intro);

  // Split into words and reveal word-by-word on scroll.
  const h3 = intro.querySelector("h3");
  if (!h3) return;
  const spans = Array.from(h3.querySelectorAll(".word"));
  let revealed = 0;
  let rafScheduled = false;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const revealNext = () => {
    if (reducedMotion()) {
      spans.forEach(s => s.classList.add("is-in"));
      return;
    }
    if (revealed >= spans.length) return;
    // Reveal up to 2 words per frame so the whole reveal completes in about 2s
    // when scrolling slowly; faster scroll reveals more per frame.
    const perFrame = Math.max(1, Math.ceil(spans.length / 60));
    const batch = Math.min(perFrame, spans.length - revealed);
    for (let i = 0; i < batch; i++) {
      if (revealed < spans.length) {
        spans[revealed].classList.add("is-in");
        revealed++;
      }
    }
    if (revealed < spans.length) {
      rafScheduled = true;
      requestAnimationFrame(() => { rafScheduled = false; revealNext(); });
    }
  };

  const checkScroll = () => {
    if (!intro.isConnected) return;
    const rect = intro.getBoundingClientRect();
    const triggerPoint = window.innerHeight * 0.6;
    if (rect.top < triggerPoint && rect.bottom > 0) {
      revealNext();
    }
  };

  // Initial check and continuous scroll listener.
  checkScroll();
  window.addEventListener("scroll", checkScroll, { passive: true });
  window.addEventListener("resize", checkScroll, { passive: true });

  // Ensure cleanup if the user navigates away.
  const cleanup = () => {
    window.removeEventListener("scroll", checkScroll);
    window.removeEventListener("resize", checkScroll);
  };
  intro._cleanup = cleanup;
}

/* HOME HERO — map + inscription ----------------------------------------- */

const HERO_MAP = {
  src: "images/header_map.svg",
  /* The drawing is only used for its outline. These bounds say which part of
     the globe the drawing covers, so the Tamil Nadu crop can be placed in
     degrees instead of guessed pixels. */
  geo: { lon: [67.8, 97.6], lat: [6.0, 37.4] },
  /* What the header shows: Tamil Nadu and the country around her. */
  crop: { lon: [75.7, 80.9], lat: [7.4, 14.1] }
};

const INSCRIPTION_TAMIL = "𑌸𑍍𑌵𑌸𑍍𑌤𑌿 𑌶𑍍𑌰𑍀 திருமகள் பொலப்பெருநிலச்செல்வியுந்தனக்கெயுரிமை பூண்டமை மனக்கொள்க்காந்தளூச்சாலை கலமறுத்தருளி வெங்கைநாடுங்கங்கபாடியுநுளம்பபாடியுந்தடிகைபாடியுங்குடமலைநாடுங்கொல்லமுங்கலிங்கமும் எண்டிசை புகழ் தர ஈழமண்டலமும் இரட்டபாடி எழரை இலக்கமுந்திரண்டிறல் வென்றித்தண்டாற்கொண்ட தன்னெழில் வளரூழியுளெல்லாயாண்டுந்தொழுதக விளங்கும் யாண்டெ செழியரைத்தசு கொள் கொராஐகெஸரிவர்மரான 𑌶𑍍𑌰𑍀ராஜராஜ தெவர்க்கு யாண்டு இருபத்தொன்பதாவது வரை உடையார் 𑌶𑍍𑌰𑍀ராஜராஜீஸ்வரம் உடையார்க்குத் திருருவிளக்குக்கு உடையார் 𑌶𑍍𑌰𑍀ராஜராஜதெவர் குடுத்த கால்மாட்டிலுங்குடுத்தார் குடுத்த கால்மாட்டிலுங்காசு குடுத்து முதலான கால்மாட்டிலும் திருவிளக்குக்கு நெய் அளக்க கடவர்களாக இடையர் வழி திருவிளக்கு ஒன்றினுக்கு ஆடு தொண்ணூற்றுறுகவும் பசு நாற்பத்தெட்டாகவும் எருமை பதிநாறாகவும் இவையிற்று...";

const INSCRIPTION_ENGLISH = "Hail! Prosperity! While the goddess of fortune, the goddess of the great earth, and the goddess of victory became his exclusive right, he destroyed the ships at Kanthalur Salai, and conquered Vengainadu, Gangapadi, Nulambapadi, Thadigaipadi, Kudamalainadu, Kollam, Kalingam, Elamandalam whose fame spread to all eight directions, and Rattapadi seven and a half lakshas, with his formidable and victorious army. In the twenty-ninth year of the reign of Ko-Rajarakesarivarman, also known as Sri Rajaraja Deva, who shines brightly with growing grace through all the ages, the following endowment was made for the sacred lamps of the deity at Sri Rajarajeswaram. Sri Rajaraja Deva gave sheep and cattle. With the money given for the cattle, the shepherds are bound to measure out ghee for the sacred lamps. For one sacred lamp following the shepherd lineage, ninety-six sheep, forty-eight cows, and sixteen buffaloes were given.";

async function initHeroMap() {
  const figure = document.getElementById("heroMap");
  if (!figure) return;
  const frame = figure.querySelector(".hero-map-frame");
  const mount = figure.querySelector(".hero-map-mount");
  if (!frame || !mount) return;
  const alt = figure.querySelector("#heroMapAlt");

  let source = "";
  try {
    const res = await fetch(HERO_MAP.src);
    if (!res.ok) throw new Error("header map " + res.status);
    source = await res.text();
  } catch (err) {
    figure.classList.add("is-missing");   // no drawing yet: the hero keeps its text
    return;
  }
  if (!frame.isConnected) return;

  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (!parsed || parsed.querySelector("parsererror") || parsed.documentElement.nodeName.toLowerCase() !== "svg") {
    figure.classList.add("is-missing");
    return;
  }

  const NS = "http://www.w3.org/2000/svg";
  const node = (name, attrs) => {
    const n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(k => n.setAttribute(k, attrs[k]));
    return n;
  };

  const svg = node("svg", { class: "hero-map-svg", "aria-hidden": "true" });
  const defs = node("defs");

  /* The drawing itself. Its shapes are painted by CSS so the map follows the
     theme, and its geometry is what both the crop and the text clip use. */
  const art = node("g", { id: "heroMapArt", class: "hero-map-art" });
  while (parsed.documentElement.firstChild) art.appendChild(parsed.documentElement.firstChild);

  /* The land mask is a copy of the drawing painted white, so both text layers
     stop at the coastline. A mask (not a clipPath) because a transform inside
     a clipPath is unreliable across browsers. */
  // x/y must be set: left at their defaults the mask region starts 10% above
  // the origin and stops 10% short of the far edge, hiding the last lines.
  const landMask = node("mask", {
    id: "heroLandMask", maskUnits: "userSpaceOnUse", maskContentUnits: "userSpaceOnUse", x: "0", y: "0"
  });
  const landShape = node("g");
  const landCopy = art.cloneNode(true);
  landCopy.removeAttribute("id");
  landCopy.removeAttribute("class");
  landCopy.querySelectorAll("[id]").forEach(n => n.removeAttribute("id"));
  landCopy.querySelectorAll("path, polygon, polyline, rect, circle, ellipse").forEach(n => {
    n.setAttribute("fill", "#fff");
    n.removeAttribute("stroke");
  });
  landShape.appendChild(landCopy);
  landMask.appendChild(landShape);
  defs.appendChild(landMask);

  /* The ripple is a clipped circle: clip-path and mask then sit on one element,
     which renders far more predictably than nesting one inside the other. */
  const rippleClip = node("clipPath", { id: "heroRippleClip", clipPathUnits: "userSpaceOnUse" });
  const maskDot = node("circle", { cx: "0", cy: "0", r: "0" });
  rippleClip.appendChild(maskDot);
  defs.appendChild(rippleClip);

  const view = node("g", { class: "hero-map-view" });
  view.appendChild(art);

  const tamilLayer = node("g", { class: "hero-insc hero-insc-ta", mask: "url(#heroLandMask)" });
  const englishLayer = node("g", { class: "hero-insc hero-insc-en", mask: "url(#heroLandMask)" });
  const englishReveal = node("g", { "clip-path": "url(#heroRippleClip)" });
  englishLayer.appendChild(englishReveal);

  const ring = node("circle", { class: "hero-map-ring", cx: "0", cy: "0", r: "0" });

  svg.append(defs, view, tamilLayer, englishLayer, ring);
  mount.appendChild(svg);
  if (alt) alt.textContent = "Tamil inscription with its English translation: " + INSCRIPTION_ENGLISH;

  const segmenter = (() => {
    try { return new Intl.Segmenter("ta", { granularity: "grapheme" }); } catch (e) { return null; }
  })();
  const glyphs = segmenter
    ? Array.from(segmenter.segment(INSCRIPTION_TAMIL), part => part.segment)
    : (INSCRIPTION_TAMIL.match(/\P{M}\p{M}*/gu) || Array.from(INSCRIPTION_TAMIL));

  const narrowQuery = window.matchMedia("(max-width: 767px)");
  let W = 0, H = 0, box = null, span = 1;

  /* Frame the crop and lay both layers out inside it. Everything lives in the
     panel's own pixel grid, so a resize is just another measurement. */
  function resize() {
    if (!svg.isConnected) return;
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    W = rect.width;
    H = rect.height;
    span = Math.hypot(W, H);
    svg.setAttribute("viewBox", "0 0 " + W.toFixed(2) + " " + H.toFixed(2));

    const b = art.getBBox();
    if (!b || !b.width || !b.height) {
      box = { x: 12, y: 12, x2: W - 12, y2: H - 12 };
      layoutText();
      paint();
      return;
    }

    const g = HERO_MAP.geo, c = HERO_MAP.crop;
    const sx = b.width / (g.lon[1] - g.lon[0]);
    const sy = b.height / (g.lat[1] - g.lat[0]);
    const x0 = b.x + (c.lon[0] - g.lon[0]) * sx;
    const x1 = b.x + (c.lon[1] - g.lon[0]) * sx;
    const y0 = b.y + (g.lat[1] - c.lat[1]) * sy;
    const y1 = b.y + (g.lat[1] - c.lat[0]) * sy;
    const s = Math.max(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0));
    const tx = W / 2 - ((x0 + x1) / 2) * s;
    const ty = H / 2 - ((y0 + y1) / 2) * s;
    const t = "translate(" + tx.toFixed(2) + " " + ty.toFixed(2) + ") scale(" + s.toFixed(5) + ")";
    view.setAttribute("transform", t);
    landShape.setAttribute("transform", t);
    landMask.setAttribute("width", W.toFixed(2));
    landMask.setAttribute("height", H.toFixed(2));

    const left = Math.max(10, b.x * s + tx);
    const top = Math.max(10, b.y * s + ty);
    const right = Math.min(W - 10, (b.x + b.width) * s + tx);
    const bottom = Math.min(H - 10, (b.y + b.height) * s + ty);
    box = (right - left > 40 && bottom - top > 40)
      ? { x: left, y: top, x2: right, y2: bottom }
      : { x: 12, y: 12, x2: W - 12, y2: H - 12 };

    spanCache.clear();
    rasterizeLand();
    layoutText();
    paint();
  }

  /* The inscription is a field of single glyphs on a square grid, sized so the
     whole text fits the land; the coastline clip does the shaping. */
  function layoutText() {
    if (!box) return;
    const bw = Math.max(40, box.x2 - box.x);
    const bh = Math.max(40, box.y2 - box.y);
    const CELL_W = 1.44, CELL_H = 1.52, n = glyphs.length;
    let fs = 12, cols = 0, rows = 0;
    for (let i = 0; i < 80; i++) {
      cols = Math.max(4, Math.floor(bw / (fs * CELL_W)));
      rows = Math.ceil(n / cols);
      if (rows * fs * CELL_H <= bh) break;
      fs *= 0.972;
      if (fs < 5.5) { fs = 5.5; break; }
    }

    const cw = fs * CELL_W, ch = fs * CELL_H;
    const x0 = box.x + Math.max(0, (bw - cols * cw) / 2);
    const y0 = box.y + Math.max(0, (bh - rows * ch) / 2);
    const frag = document.createDocumentFragment();
    glyphs.forEach((glyph, i) => {
      if (!glyph.trim()) return;
      const r = Math.floor(i / cols);
      const c = i - r * cols;
      const t = node("text", {
        x: (x0 + c * cw + cw / 2).toFixed(2),
        y: (y0 + r * ch + ch / 2 + fs * 0.34).toFixed(2),
        "font-size": fs.toFixed(2)
      });
      t.textContent = glyph;
      frag.appendChild(t);
    });
    tamilLayer.replaceChildren(frag);

    layoutEnglish();
  }

  /* The drawing is rasterised once per resize so the translation can ask where
     the land actually is, line by line. Canvas hit-testing also works while
     the panel is off-screen, which elementFromPoint does not. */
  let landData = null;
  function rasterizeLand() {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(W));
    canvas.height = Math.max(1, Math.round(H));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    art.querySelectorAll("path, polygon, polyline, rect, circle, ellipse").forEach(el => {
      const ctm = el.getCTM();
      if (!ctm) return;
      const tag = el.tagName.toLowerCase();
      const num = n => parseFloat(el.getAttribute(n) || "0");
      const shape = new Path2D();
      if (tag === "path") {
        const d = el.getAttribute("d");
        if (!d) return;
        try { shape.addPath(new Path2D(d)); } catch (err) { return; }
      } else if (tag === "rect") {
        shape.rect(num("x"), num("y"), num("width"), num("height"));
      } else if (tag === "circle") {
        shape.arc(num("cx"), num("cy"), num("r"), 0, Math.PI * 2);
      } else if (tag === "ellipse") {
        shape.ellipse(num("cx"), num("cy"), num("rx"), num("ry"), 0, 0, Math.PI * 2);
      } else {
        const pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
        if (pts.length < 6) return;
        shape.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) shape.lineTo(pts[i], pts[i + 1]);
        shape.closePath();
      }
      ctx.save();
      ctx.setTransform(ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f);
      ctx.fill(shape);
      ctx.restore();
    });
    try { landData = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch (err) { landData = null; }
  }

  function isLand(x, y) {
    if (!landData) return false;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= landData.width || py >= landData.height) return false;
    return landData.data[(py * landData.width + px) * 4 + 3] > 8;
  }

  const spanCache = new Map();
  function spanAt(y) {
    const key = Math.round(y / 3);
    if (!spanCache.has(key)) spanCache.set(key, landSpanAt(key * 3));
    return spanCache.get(key);
  }

  function landSpanAt(y) {
    if (!box) return null;
    const step = Math.max(2, W / 96);
    let best = null;
    let start = null;
    for (let x = box.x; x <= box.x2 + step * 0.5; x += step) {
      const px = Math.min(x, box.x2);
      const on = isLand(px, y);
      if (on && start === null) start = x;
      else if (!on && start !== null) {
        if (!best || px - start > best[1] - best[0]) best = [start, px - step];
        start = null;
      }
    }
    if (start !== null && (!best || box.x2 - start > best[1] - best[0])) best = [start, box.x2];
    return best;
  }

  let measureCtx = null;
  function textWidth(text, size) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = '400 ' + size.toFixed(2) + 'px "Libre Baskerville", Georgia, serif';
    return measureCtx.measureText(text).width;
  }

  function layoutEnglish() {
    if (!box) return;
    const words = INSCRIPTION_ENGLISH.split(/\s+/).filter(Boolean);
    const bw = Math.max(60, box.x2 - box.x);
    const bh = Math.max(60, box.y2 - box.y);
    // Narrow panels need tighter leading and a smaller floor or the paragraph
    // runs out of rows before the last word.
    const leading = bw < 390 ? 1.42 : 1.5;
    spanCache.clear();

    function buildLines(size) {
      const lh = size * leading;
      const rows = Math.floor((bh - size) / lh);
      let next = 0;
      const out = [];
      for (let row = 0; row < rows && next < words.length; row++) {
        const y = box.y + row * lh + size * 1.15;
        // The line must sit on land from its ascender to its descender, so ask
        // for both and keep only the part of the row that is land all the way.
        const cap = spanAt(y - size * 0.45);
        const foot = spanAt(y + size * 0.22);
        if (!cap || !foot) continue;
        const span = [Math.max(cap[0], foot[0]), Math.min(cap[1], foot[1])];
        if (span[1] - span[0] < 26) continue;
        const avail = span[1] - span[0] - 3;
        if (avail < 26) continue;
        const start = next;
        let line = words[next];
        next++;
        while (next < words.length) {
          const wider = line + " " + words[next];
          if (textWidth(wider, size) > avail) break;
          line = wider;
          next++;
        }
        const width = textWidth(line, size);
        // Every glyph of the line has to sit on land, otherwise the coast cuts
        // it in half. If it does not, leave the words for the next row.
        const solid = [0, 0.25, 0.5, 0.75, 1].every(f => {
          const x = span[0] + 1 + width * f;
          return isLand(x, y - size * 0.45) && isLand(x, y + size * 0.22);
        });
        if (!solid) { next = start; continue; }
        out.push({ text: line, x: span[0] + 1, y: y, width: width, avail: avail, end: next >= words.length });
      }
      return { lines: out, size: size, complete: next >= words.length };
    }

    // Grow the type until the paragraph fills the land, shrink it until it fits.
    let lo = Math.max(7.2, Math.min(8.6, bw / 42));
    let hi = Math.max(11, Math.min(15.5, bw / 26));
    let best = buildLines(lo);
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      const attempt = buildLines(mid);
      if (attempt.complete) { best = attempt; lo = mid; } else { hi = mid; }
    }

    const frag = document.createDocumentFragment();
    best.lines.forEach(line => {
      const t = node("text", { x: line.x.toFixed(1), y: line.y.toFixed(1), "font-size": best.size.toFixed(2) });
      const stretch = line.width ? line.avail / line.width : 9;
      if (!line.end && stretch > 1 && stretch < 1.12) {
        t.setAttribute("textLength", line.avail.toFixed(1));
        t.setAttribute("lengthAdjust", "spacing");
      }
      t.textContent = line.text;
      frag.appendChild(t);
    });
    englishReveal.replaceChildren(frag);
  }

  let radius = 0, cx = 0, cy = 0, rafId = 0, demoTimer = 0, hideTimer = 0;
  let active = false;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function paint() {
    const sx = cx.toFixed(2), sy = cy.toFixed(2), sr = radius.toFixed(2);
    maskDot.setAttribute("r", sr);
    maskDot.setAttribute("cx", sx);
    maskDot.setAttribute("cy", sy);
    ring.setAttribute("r", sr);
    ring.setAttribute("cx", sx);
    ring.setAttribute("cy", sy);
    const p = Math.min(1, radius / Math.max(1, span));
    tamilLayer.style.opacity = (1 - 0.92 * Math.min(1, p * 1.7)).toFixed(3);
    ring.style.opacity = (radius > 2 ? 0.55 * (1 - p) : 0).toFixed(3);
  }

  function animateTo(on, x, y) {
    if (typeof x === "number" && typeof y === "number") { cx = x; cy = y; }
    const to = on ? span : 0;
    const from = radius;
    const dur = reduced() ? 0 : (on ? 820 : 620);
    const start = performance.now();
    cancelAnimationFrame(rafId);
    if (!dur) { radius = to; paint(); return; }
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      radius = from + (to - from) * e;
      paint();
      if (k < 1) rafId = requestAnimationFrame(step);
    };
    paint();
    rafId = requestAnimationFrame(step);
  }

  function localPoint(e) {
    const r = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W, e.clientX - r.left)),
      y: Math.max(0, Math.min(H, e.clientY - r.top))
    };
  }

  function activate(pt) {
    active = true;
    figure.classList.add("is-live");
    clearTimeout(demoTimer);
    clearTimeout(hideTimer);
    if (pt) animateTo(true, pt.x, pt.y);
    else animateTo(true);
  }

  function deactivate() {
    active = false;
    figure.classList.remove("is-live");
    animateTo(false);
    scheduleDemo();
  }

  /* Ripples on their own, so the page shows the reader what the map does. */
  function scheduleDemo() {
    clearTimeout(demoTimer);
    if (reduced()) return;
    const mobile = narrowQuery.matches;
    const delay = mobile ? 4800 + Math.random() * 2200 : 11000 + Math.random() * 5000;
    demoTimer = setTimeout(() => {
      if (!svg.isConnected) return;
      if (!active && box) {
        const px = box.x + (0.16 + Math.random() * 0.68) * (box.x2 - box.x);
        const py = box.y + (0.14 + Math.random() * 0.6) * (box.y2 - box.y);
        animateTo(true, px, py);
        hideTimer = setTimeout(() => {
          if (!active) animateTo(false);
        }, mobile ? 1800 : 2200);
      }
      scheduleDemo();
    }, delay);
  }

  frame.addEventListener("pointerenter", e => {
    if (e.pointerType === "touch") return;
    activate(localPoint(e));
  });
  frame.addEventListener("pointerleave", e => {
    if (e.pointerType === "touch") return;
    deactivate();
  });
  frame.addEventListener("pointerup", e => {
    if (e.pointerType === "mouse") return;
    if (active) deactivate();
    else activate(localPoint(e));
  });
  frame.addEventListener("click", e => {
    // Keyboard-activated clicks arrive with detail 0; touch is handled above.
    if (e.detail !== 0) return;
    if (active) deactivate();
    else activate({ x: W / 2, y: H / 2 });
  });
  frame.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    if (active) deactivate();
    else activate({ x: W / 2, y: H / 2 });
  });

  let pending = 0;
  const onResize = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; resize(); });
  };
  window.addEventListener("resize", onResize);
  let ro = null;
  if ("ResizeObserver" in window) {
    ro = new ResizeObserver(onResize);
    ro.observe(frame);
  }

  figure.classList.add("is-ready");
  cx = W / 2;
  cy = H / 2;
  resize();
  paint();
  scheduleDemo();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (svg.isConnected) { resize(); } });
  }

  heroCleanup = () => {
    cancelAnimationFrame(rafId);
    if (pending) cancelAnimationFrame(pending);
    clearTimeout(demoTimer);
    clearTimeout(hideTimer);
    if (ro) ro.disconnect();
    window.removeEventListener("resize", onResize);
    figure.classList.remove("is-ready", "is-live");
  };
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
  if (dynCleanup) { dynCleanup(); dynCleanup = null; }

  const allKings = DATA.kings.filter(k => k.accession_year_ce);
  if (!allKings.length) {
    $app().innerHTML = "<p>No kings with dates found.</p>";
    return;
  }

  /* The timeline is measured in pixels, not years. Every stretch of time
     starts at the default pace (PX_PER_YEAR) and only grows when the cards
     sitting in that stretch need the extra room, so sparse centuries stay
     compact while crowded ones expand. */
  const CARD_MIN_H = 112;   // keep in sync with .dyn-card { min-height }
  const CARD_GAP = 18;      // minimum space between cards sharing a year
  const YEAR_GAP = 26;      // minimum space between two different years
  const PX_PER_YEAR = 1.6;  // default pace: 80px per 50 years
  const TOP_PAD = 24;       // space below the sticky lane header
  const END_PAD = 80;       // space after the last card
  const PINS_PAD = 108;     // room kept clear for the pinned unidentified-king cards
  const COMPACT_GAP = 16;   // mobile: fixed gap between rulers, no empty centuries

  const cholaKings = allKings.filter(k => k.dynasty === "Chola")
    .sort((a, b) => a.accession_year_ce - b.accession_year_ce);
  const pandyaKings = allKings.filter(k => k.dynasty === "Pandya")
    .sort((a, b) => a.accession_year_ce - b.accession_year_ce);
  const minY = Math.min(...allKings.map(k => k.accession_year_ce));
  const maxY = Math.max(...allKings.map(k => k.end_year_ce || k.accession_year_ce));

  function renderCards(kings, dyn) {
    return kings.map(k => {
      const years = (k.accession_year_ce && k.end_year_ce)
        ? `${k.accession_year_ce}–${k.end_year_ce} CE`
        : (k.century || "");
      const count = (INDEX.byKing[k.king_id] || []).length;
      const bio = k.short_bio
        ? `<div class="bio">${escapeHtml(clipText(k.short_bio, 220))}</div>`
        : "";
      const branch = k.dynasty_branch ? `<span class="meta">${escapeHtml(k.dynasty_branch)}</span>` : "";
      const subCls = k.ruling_status === "subsidiary" ? " sub" : "";
      return `<a href="#/king/${k.king_id}" class="dyn-card ${dyn.toLowerCase()}${subCls} reveal" data-year="${k.accession_year_ce}">
        <h3>${escapeHtml(k.king_name_standard)}</h3>
        <div class="years">${escapeHtml(years)}${count ? ` · ${count} insc` : ""}</div>
        ${branch}
        ${bio}
      </a>`;
    }).join("");
  }

  /* The two rulers who could not be dated are pinned to the foot of the frame,
     the way the lane headers stay pinned to its top. */
  function pinCard(dyn) {
    const id = dyn === "Chola" ? "chola_king_unidentified" : "pandya_king_unidentified";
    const k = DATA.kings.find(x => x.king_id === id);
    const name = k ? k.king_name_standard : `Unidentified ${dyn === "Chola" ? "Chola" : "Pandyan"} King`;
    const count = (INDEX.byKing[id] || []).length;
    return `<a href="#/king/${id}" class="dyn-pin ${dyn.toLowerCase()}">
        <span class="pin-name">${escapeHtml(name)}</span>
        <span class="pin-meta">${count} inscription${count === 1 ? "" : "s"} · reign unknown</span>
      </a>`;
  }

  $app().innerHTML = `
    <div class="dyn-page">
      <h2>Dynasties</h2>
      <div class="dyn-switch">
        <button class="active" data-mode="both">Both</button>
        <button data-mode="chola">Chola</button>
        <button data-mode="pandya">Pandya</button>
      </div>
      <div class="dyn-frame">
        <div class="dyn-timeline-wrap" id="dynWrap">
          <div class="dyn-timeline" id="dynTl">
            <div class="dyn-lane chola">
              <div class="dyn-lane-header chola"><img src="images/icons/chola_emblem.png" alt="" width="28" height="28"> Chola</div>
              ${renderCards(cholaKings, "Chola")}
            </div>
            <div class="dyn-axis" id="dynAxis"></div>
            <div class="dyn-lane pandya">
              <div class="dyn-lane-header pandya"><img src="images/icons/pandya_emblem.png" alt="" width="28" height="28"> Pandya</div>
              ${renderCards(pandyaKings, "Pandya")}
            </div>
          </div>
        </div>
        <div class="dyn-pins">
          ${pinCard("Chola")}
          ${pinCard("Pandya")}
        </div>
      </div>
    </div>
  `;

  const wrap = document.getElementById("dynWrap");
  const tl = document.getElementById("dynTl");
  const axis = document.getElementById("dynAxis");
  if (!wrap || !tl || !axis) return;
  const laneEls = Array.from(tl.querySelectorAll(".dyn-lane"));
  const cardEls = Array.from(tl.querySelectorAll(".dyn-card"));

  let anchors = [];      // [{ year, y }] — the piecewise-linear year ruler
  let firstPass = true;
  let frameId = 0;
  let seenWidth = -1;

  /* Phones show one dynasty at a time, packed tight; the side-by-side ruler
     needs the width that only a desktop viewport has. */
  const narrowQuery = window.matchMedia("(max-width: 700px)");
  const switchBtns = Array.from(document.querySelectorAll(".dyn-switch button"));
  let mode = narrowQuery.matches ? "chola" : "both";

  /* Size the scroller to the room actually left on screen, so the pinned
     cards at its foot are never pushed under the bottom of the window (or
     under the mobile bottom bar). */
  function sizeWrap() {
    const nav = document.querySelector(".bottom-nav");
    const navH = nav && getComputedStyle(nav).display !== "none" ? nav.getBoundingClientRect().height : 0;
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - top - navH - 36;
    wrap.style.height = Math.max(260, Math.round(available)) + "px";
  }

  function applyMode() {
    laneEls[0].style.display = mode === "pandya" ? "none" : "";
    laneEls[1].style.display = mode === "chola" ? "none" : "";
    tl.classList.toggle("single", mode !== "both");
    switchBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  }

  function headerHeight() {
    const header = tl.querySelector(".dyn-lane-header");
    return header ? header.offsetHeight : 56;
  }

  function yearToY(year) {
    if (!anchors.length) return TOP_PAD;
    if (year <= anchors[0].year) return anchors[0].y - (anchors[0].year - year) * PX_PER_YEAR;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (year <= b.year) {
        const t = (year - a.year) / Math.max(1, b.year - a.year);
        return a.y + t * (b.y - a.y);
      }
    }
    const last = anchors[anchors.length - 1];
    return last.y + (year - last.year) * PX_PER_YEAR;
  }

  function yToYear(y) {
    if (!anchors.length) return minY;
    if (y <= anchors[0].y) return anchors[0].year - (anchors[0].y - y) / PX_PER_YEAR;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1], b = anchors[i];
      if (y <= b.y) {
        const t = (y - a.y) / Math.max(1, b.y - a.y);
        return a.year + t * (b.year - a.year);
      }
    }
    const last = anchors[anchors.length - 1];
    return last.year + (y - last.y) / PX_PER_YEAR;
  }

  function layoutTimeline() {
    if (!tl.isConnected) return;

    // Lanes hidden by the mobile dynasty switch still need their real width
    // while heights are measured; restore them right after.
    const hiddenLanes = laneEls.filter(lane => lane.style.display === "none");
    hiddenLanes.forEach(lane => { lane.style.display = ""; });

    const top = headerHeight() + TOP_PAD;

    // Measure every card and group it per dynasty by accession year.
    const laneGroups = laneEls.map(lane => {
      const byYear = new Map();
      lane.querySelectorAll(".dyn-card").forEach(card => {
        const year = Number(card.dataset.year);
        if (!Number.isFinite(year)) return;
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push({ el: card, h: Math.max(CARD_MIN_H, card.offsetHeight) });
      });
      return [...byYear.entries()]
        .map(([year, cards]) => ({ year, cards }))
        .sort((a, b) => a.year - b.year);
    });

    const allYears = [...new Set(laneGroups.flat().map(group => group.year))].sort((a, b) => a - b);

    /* One shared year ruler for both lanes. It starts at the default pace and
       is only stretched where a dynasty's own cards need the extra room; the
       constraints are solved together so both lanes stay on the same years. */
    let scale = new Map(allYears.map(year => [year, top + (year - allYears[0]) * PX_PER_YEAR]));

    function stackLane(groups, ruler, required) {
      let previousBottom = -Infinity;
      groups.forEach(group => {
        const start = Math.max(ruler.get(group.year), previousBottom + YEAR_GAP);
        if (required) required.set(group.year, Math.max(required.get(group.year) ?? -Infinity, start));
        let bottom = start;
        group.cards.forEach(card => { bottom += card.h + CARD_GAP; });
        previousBottom = bottom - CARD_GAP;
      });
    }

    for (let pass = 0; pass < 24; pass++) {
      const required = new Map();
      laneGroups.forEach(groups => stackLane(groups, scale, required));

      const next = new Map();
      let previousYear = allYears[0];
      let previousY = top;
      let changed = Math.abs(scale.get(previousYear) - top) > 0.25;
      next.set(previousYear, top);
      for (let i = 1; i < allYears.length; i++) {
        const year = allYears[i];
        const paced = previousY + (year - previousYear) * PX_PER_YEAR;
        const y = Math.max(paced, required.get(year));
        if (Math.abs(y - scale.get(year)) > 0.25) changed = true;
        next.set(year, y);
        previousY = y;
        previousYear = year;
      }
      scale = next;
      if (!changed) break;
    }

    // Place the cards on the ruler: a shared year sits on one line, and cards
    // of the same dynasty and year stack downwards with a fixed gap.
    const positions = [];
    const yearTops = new Map();
    let lowest = top;
    laneGroups.forEach(groups => {
      let previousBottom = -Infinity;
      groups.forEach(group => {
        let y = Math.max(scale.get(group.year), previousBottom + YEAR_GAP);
        yearTops.set(group.year, Math.max(yearTops.get(group.year) ?? -Infinity, y));
        group.cards.forEach(card => {
          positions.push([card.el, y]);
          y += card.h + CARD_GAP;
        });
        previousBottom = y - CARD_GAP;
        lowest = Math.max(lowest, previousBottom);
      });
    });

    const endY = Math.round(lowest + END_PAD + PINS_PAD);
    anchors = [...yearTops.entries()]
      .map(([year, y]) => ({ year, y: Math.round(y) }))
      .sort((a, b) => a.year - b.year);
    anchors.push({ year: Math.max(maxY + 20, anchors[anchors.length - 1].year + 1), y: endY });

    positions.forEach(([el, y]) => { el.style.top = Math.round(y) + "px"; });

    const totalHeight = Math.max(endY, wrap.clientHeight || 0);
    tl.style.height = totalHeight + "px";
    axis.style.height = totalHeight + "px";

    // Year marks every 50 years, placed with the same ruler as the cards so
    // the axis stretches exactly where the cards need the room.
    const marks = [];
    for (let year = Math.ceil(minY / 50) * 50; year <= maxY; year += 50) {
      marks.push(`<div class="dyn-year-label" style="top:${Math.round(yearToY(year))}px">${year}</div>`);
    }
    axis.innerHTML = `<div class="dyn-axis-line"></div>${marks.join("")}`;

    seenWidth = tl.clientWidth;

    // Open the page around 850 CE, the start of the Chola record.
    if (firstPass) {
      firstPass = false;
      const previousBehavior = wrap.style.scrollBehavior;
      wrap.style.scrollBehavior = "auto";
      wrap.scrollTop = Math.max(0, yearToY(850) - headerHeight() - 16);
      wrap.style.scrollBehavior = previousBehavior;
    }

    hiddenLanes.forEach(lane => { lane.style.display = "none"; });
  }

  /* Phones: one lane, chronological, packed with a fixed gap so an empty
     century never leaves a hole in the list. */
  function layoutCompact() {
    if (!tl.isConnected) return;
    const lane = laneEls.find(l => l.style.display !== "none") || laneEls[0];
    if (!lane) return;
    const cards = Array.from(lane.querySelectorAll(".dyn-card"));
    const heights = cards.map(card => Math.max(CARD_MIN_H, card.offsetHeight));
    let y = headerHeight() + COMPACT_GAP;
    cards.forEach((card, i) => {
      card.style.top = Math.round(y) + "px";
      y += heights[i] + COMPACT_GAP;
    });
    const totalHeight = Math.max(Math.round(y + PINS_PAD), wrap.clientHeight || 0);
    tl.style.height = totalHeight + "px";
    axis.style.height = totalHeight + "px";
    axis.innerHTML = "";
    anchors = [];
    seenWidth = tl.clientWidth;
  }

  /* One entry point: pick the layout that suits the current width and keep the
     tab state honest when crossing the breakpoint. */
  function layout() {
    const narrow = narrowQuery.matches;
    mode = narrow ? (mode === "both" ? "chola" : mode) : "both";
    applyMode();
    sizeWrap();
    if (narrow) layoutCompact();
    else layoutTimeline();
  }

  // Re-run the layout on resize or after the web fonts load, keeping the
  // century the reader was looking at in view.
  function relayout() {
    if (!tl.isConnected) return;
    const keepScroll = !narrowQuery.matches && anchors.length;
    const yearAtTop = keepScroll ? yToYear(wrap.scrollTop + headerHeight() + 12) : 0;
    layout();
    if (!tl.isConnected || !keepScroll) return;
    const previousBehavior = wrap.style.scrollBehavior;
    wrap.style.scrollBehavior = "auto";
    wrap.scrollTop = Math.max(0, yearToY(yearAtTop) - headerHeight() - 12);
    wrap.style.scrollBehavior = previousBehavior;
  }

  function queueRelayout() {
    if (frameId) return;
    frameId = requestAnimationFrame(() => { frameId = 0; relayout(); });
  }

  layout();

  // Fade cards in as they enter the scroll area.
  let revealObserver = null;
  if ("IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      });
    }, { root: wrap, threshold: 0.1, rootMargin: "0px 0px -4% 0px" });
    cardEls.forEach(card => revealObserver.observe(card));
  } else {
    cardEls.forEach(card => card.classList.add("in"));
  }

  // Dynasty switch (small screens)
  switchBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      applyMode();
      layout();
      wrap.scrollTop = 0;
    });
  });

  let resizeObserver = null;
  if ("ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - seenWidth) < 2) return;
      seenWidth = width;
      queueRelayout();
    });
    resizeObserver.observe(tl);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (tl.isConnected) queueRelayout(); });
  }

  const onResize = () => queueRelayout();
  window.addEventListener("resize", onResize);

  dynCleanup = () => {
    window.removeEventListener("resize", onResize);
    if (resizeObserver) resizeObserver.disconnect();
    if (revealObserver) revealObserver.disconnect();
    if (frameId) cancelAnimationFrame(frameId);
  };
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

/* SCROLL RISE — cards float up into place, and float up again as they leave */
const RISE_SELECTOR = ".card, .insc-card, .stat, .king-sidebar, .king-nav-cards a";
let riseIO = null;

function riseScan(scope) {
  const root = scope || $app();
  if (!root || !root.querySelectorAll) return;
  const found = root.matches && root.matches(RISE_SELECTOR) ? [root] : [];
  root.querySelectorAll(RISE_SELECTOR).forEach(el => found.push(el));
  for (const el of found) {
    if (el.dataset.rise) continue;
    el.dataset.rise = "on";
    if (riseIO) riseIO.observe(el);
    else el.classList.add("is-in");
  }
}

function initRise() {
  const app = $app();
  if (!app) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "IntersectionObserver" in window) {
    riseIO = new IntersectionObserver(entries => {
      for (const e of entries) {
        const el = e.target;
        if (e.isIntersecting) {
          const d = Math.max(0, Math.min(90, (e.boundingClientRect.top / window.innerHeight) * 90));
          el.style.setProperty("--rise-delay", Math.round(d) + "ms");
          el.classList.remove("is-out");
          el.classList.add("is-in");
        } else if (e.boundingClientRect.top < 0) {
          el.classList.add("is-out");
        }
      }
    }, { rootMargin: "-32px 0px -6% 0px", threshold: 0 });
  }
  riseScan(app);
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) riseScan(n);
  }).observe(app, { childList: true, subtree: true });
}

/* Boot */
initTheme();
initRise();
loadData().then(route).catch(err => {
  $app().innerHTML = `<p>Could not load data. ${escapeHtml(err.message)}</p>`;
});
