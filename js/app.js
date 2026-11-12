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

      <figure class="hero-map" id="heroMap" aria-label="Tamil country. Gold inscription. Move the cursor to read the English."></figure>
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
    const column = h2.parentNode.getBoundingClientRect().width;
    probe.style.width = Math.max(280, column - 80) + "px";
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
  const hero = heroMapFig.closest(".hero-v2");
  (hero || heroMapFig).after(intro);

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

function prefixSvgIds(svg, prefix) {
  const ids = new Map();
  svg.querySelectorAll("[id]").forEach(el => {
    const next = prefix + el.id;
    ids.set(el.id, next);
    el.id = next;
  });
  svg.querySelectorAll("*").forEach(el => {
    ["href", "xlink:href"].forEach(attr => {
      const v = el.getAttribute(attr);
      if (v && v.charAt(0) === "#" && ids.has(v.slice(1))) {
        el.setAttribute(attr, "#" + ids.get(v.slice(1)));
      }
    });
  });
}

async function loadSvg(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  const doc = new DOMParser().parseFromString(await res.text(), "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error(url);
  }
  const node = document.importNode(svg, true);
  node.setAttribute("preserveAspectRatio", "xMinYMin meet");
  node.setAttribute("viewBox", "181.27 690 360.46 236.41");
  node.setAttribute("width", "100%");
  node.setAttribute("height", "100%");
  node.classList.add("hero-svg");
  return node;
}

function pixelLoad(host) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const block = 10;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const box = host.getBoundingClientRect();
  const cols = Math.max(1, Math.ceil(box.width / block));
  const rows = Math.max(1, Math.ceil(box.height / block));
  canvas.width = cols * block;
  canvas.height = rows * block;
  const order = [...Array(cols * rows).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }
  let shown = 0;
  let raf = 0;
  let dead = false;
  const start = performance.now();
  host.style.webkitMaskImage = "linear-gradient(transparent, transparent)";
  host.style.maskImage = "linear-gradient(transparent, transparent)";
  const frame = now => {
    if (dead) return;
    const t = Math.min(1, (now - start) / 1000);
    const want = Math.round(t * order.length);
    ctx.fillStyle = "#fff";
    while (shown < want) {
      const i = order[shown++];
      ctx.fillRect((i % cols) * block, ((i / cols) | 0) * block, block, block);
    }
    const url = canvas.toDataURL();
    host.style.webkitMaskImage = 'url("' + url + '")';
    host.style.maskImage = 'url("' + url + '")';
    host.style.webkitMaskSize = "100% 100%";
    host.style.maskSize = "100% 100%";
    host.style.webkitMaskRepeat = "no-repeat";
    host.style.maskRepeat = "no-repeat";
    if (t < 1) raf = requestAnimationFrame(frame);
    else {
      host.style.webkitMaskImage = "";
      host.style.maskImage = "";
    }
  };
  raf = requestAnimationFrame(frame);
  return () => { dead = true; cancelAnimationFrame(raf); };
}
const HERO_VB = { x: 181.27, y: 690, w: 360.46, h: 236.41 };

function renderEnglishPlate(svg, w, h) {
  const plate = document.createElement("canvas");
  plate.width = w;
  plate.height = h;
  const ctx = plate.getContext("2d");
  const scale = Math.min(w / HERO_VB.w, h / HERO_VB.h);
  const text = svg.querySelector("text");
  const fs = parseFloat((text && text.getAttribute("font-size")) || "6") * scale;
  ctx.font = '400 ' + fs.toFixed(2) + 'px "Source Sans 3", sans-serif';
  ctx.fillStyle = "#C99A3B";
  ctx.textBaseline = "alphabetic";
  svg.querySelectorAll("textPath").forEach(tp => {
    const id = (tp.getAttribute("href") || "").slice(1);
    const path = id && svg.getElementById(id);
    const m = path && (path.getAttribute("d") || "").match(/M\s*([\d.]+)\s*,\s*([\d.]+)\s*L\s*([\d.]+)/);
    if (!m) return;
    const x0 = (parseFloat(m[1]) - HERO_VB.x) * scale;
    const y0 = (parseFloat(m[2]) - HERO_VB.y) * scale;
    const width = (parseFloat(tp.getAttribute("textLength")) || 0) * scale;
    const chars = Array.from(tp.textContent || "");
    if (!chars.length || !width) return;
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const gap = chars.length > 1 ? (width - widths.reduce((a, b) => a + b, 0)) / (chars.length - 1) : 0;
    let cx = x0;
    chars.forEach((ch, i) => { ctx.fillText(ch, cx, y0); cx += widths[i] + gap; });
  });
  return plate;
}

function pixelateCanvas(src, block) {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (block <= 1) { ctx.drawImage(src, 0, 0); return out; }
  const tw = Math.max(1, Math.round(src.width / block));
  const th = Math.max(1, Math.round(src.height / block));
  const tiny = document.createElement("canvas");
  tiny.width = tw;
  tiny.height = th;
  const tctx = tiny.getContext("2d");
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(src, 0, 0, tw, th);
  ctx.drawImage(tiny, 0, 0, tw, th, 0, 0, src.width, src.height);
  return out;
}

function makeFiber(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const n = 120 + Math.sin(x * 0.37) * 16 + Math.sin(y * 0.91) * 16 + Math.random() * 48;
      d[i] = d[i + 1] = d[i + 2] = n;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function initHeroMap() {
  const figure = document.getElementById("heroMap");
  if (!figure) return;
  let map, original, translated;
  try {
    [map, original, translated] = await Promise.all([
      loadSvg("images/header_map.svg"),
      loadSvg("images/header_original_text.svg"),
      loadSvg("images/header_translated.svg")
    ]);
  } catch (err) {
    figure.classList.add("is-missing");
    return;
  }
  if (!figure.isConnected) return;

  [original, translated].forEach((svg, i) => {
    prefixSvgIds(svg, i ? "tr_" : "orig_");
    svg.querySelectorAll("a").forEach(a => {
      const parent = a.parentNode;
      while (a.firstChild) parent.insertBefore(a.firstChild, a);
      a.remove();
    });
  });

  const base = document.createElement("div");
  base.className = "hero-layer hero-map-base";
  base.appendChild(map);

  const pixel = document.createElement("div");
  pixel.className = "hero-pixel";
  pixel.appendChild(original);
  const taWrap = document.createElement("div");
  taWrap.className = "hero-layer hero-text-ta";
  taWrap.appendChild(pixel);

const enWrap = document.createElement("div");
enWrap.className = "hero-layer hero-text-en";
enWrap.appendChild(translated);
enWrap.style.opacity = "0";
enWrap.style.visibility = "hidden";

const pixels = document.createElement("canvas");
pixels.className = "hero-layer hero-pixels";
const ring = document.createElement("span");
ring.className = "hero-ripple";
ring.setAttribute("aria-hidden", "true");
figure.replaceChildren(base, taWrap, enWrap, pixels, ring);

let plate = null, bands = [];
function rebuild() {
  const w = Math.max(1, Math.round(figure.clientWidth));
  const h = Math.max(1, Math.round(figure.clientHeight));
  if (plate && pixels.width === w && pixels.height === h) return;
  pixels.width = w;
  pixels.height = h;
  plate = renderEnglishPlate(translated, w, h);
  bands = [1, 3, 6, 14].map(block => pixelateCanvas(plate, block));
}
function blitCircle(p, cx, cy, radius, sharp) {
  if (radius < 1) return;
  const rings = sharp
    ? [[0, 1, 0]]
    : [[0, 0.58, 0], [0.56, 0.76, 1], [0.74, 0.88, 2], [0.86, 1, 3]];
  p.save();
  p.beginPath();
  p.arc(cx, cy, radius, 0, Math.PI * 2);
  p.clip();
  rings.forEach(function (band) {
    const inner = band[0], outer = band[1], idx = band[2];
    if (outer <= inner) return;
    p.save();
    p.beginPath();
    p.arc(cx, cy, radius * outer, 0, Math.PI * 2);
    if (inner > 0) p.arc(cx, cy, radius * inner, 0, Math.PI * 2, true);
    p.clip("evenodd");
    p.imageSmoothingEnabled = false;
    p.drawImage(bands[idx], 0, 0);
    p.restore();
  });
  p.restore();
  p.save();
  p.beginPath();
  p.arc(cx, cy, radius, 0, Math.PI * 2);
  p.strokeStyle = "rgba(201,154,59,0.9)";
  p.lineWidth = sharp ? 2 : 1.25;
  p.shadowColor = "rgba(201,154,59,0.75)";
  p.shadowBlur = sharp ? 16 : 8;
  p.stroke();
  p.restore();
}
function drawReveal() {
  rebuild();
  const w = pixels.width, h = pixels.height;
  const p = pixels.getContext("2d");
  p.clearRect(0, 0, w, h);
  if (!bands.length) return;
  if (r >= 1) blitCircle(p, x, y, r, opened && !sweeping);
  hints.forEach(h => blitCircle(p, h.x, h.y, h.r, false));
}

  const stopPixel = pixelLoad(pixel);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const medium = () => Math.max(92, Math.min(156, Math.round(figure.clientWidth * 0.26)));
  let tx = 0, ty = 0, x = 0, y = 0, r = 0, tr = 0, raf = 0;
  let lingerTimer = 0, dissolveRaf = 0, dissolve = 0;
  let opened = false, sweeping = false, sweep = 0, hovering = false;
  let hintTimer = 0, hintRaf = 0;
  const hints = [];

function stopSweep() {
  cancelAnimationFrame(sweep);
  sweep = 0;
}
function sweepTo(toR, toX, toY, done) {
  stopSweep();
  cancelAnimationFrame(raf);
  raf = 0;
  clearTimeout(lingerTimer);
  const fromR = r, fromX = x, fromY = y;
  const t0 = performance.now();
  const dur = reduced ? 0 : 2000;
  sweeping = true;
  figure.classList.add("is-live");
  const step = now => {
    const t = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = 1 - Math.pow(1 - t, 3);
    x = fromX + (toX - fromX) * e;
    y = fromY + (toY - fromY) * e;
    r = fromR + (toR - fromR) * e;
    tr = r; tx = x; ty = y;
    figure.style.setProperty("--rx", x + "px");
    figure.style.setProperty("--ry", y + "px");
    figure.style.setProperty("--rr", r + "px");
    figure.style.setProperty("--ring-a", "1");
    drawReveal();
    if (t < 1) sweep = requestAnimationFrame(step);
    else {
      sweeping = false;
      r = toR; x = toX; y = toY; tr = toR;
      drawReveal();
      if (done) done();
    }
  };
  sweep = requestAnimationFrame(step);
}
function coverRadius(px, py) {
  return Math.hypot(
    Math.max(px, figure.clientWidth - px),
    Math.max(py, figure.clientHeight - py)
  ) + 4;
}
function pumpHints() {
  if (hintRaf) return;
  const step = () => {
    hints.forEach(h => {
      h.t += 0.018;
      h.r = Math.sin(Math.min(1, h.t) * Math.PI) * h.max;
    });
    for (let i = hints.length - 1; i >= 0; i--) if (hints[i].t >= 1) hints.splice(i, 1);
    drawReveal();
    if (hints.length) hintRaf = requestAnimationFrame(step);
    else hintRaf = 0;
  };
  hintRaf = requestAnimationFrame(step);
}
function scheduleHint() {
  clearTimeout(hintTimer);
  if (opened || hovering || sweeping) return;
  hintTimer = setTimeout(() => {
    if (opened || hovering || sweeping || !figure.isConnected) return;
    const w = figure.clientWidth, h = figure.clientHeight;
    if (w > 40 && h > 40 && hints.length < 2) {
      hints.push({
        x: 24 + Math.random() * (w - 48),
        y: 20 + Math.random() * (h - 40),
        r: 0,
        max: 16 + Math.random() * 14,
        t: 0
      });
      pumpHints();
    }
    scheduleHint();
  }, 900 + Math.random() * 1600);
}

  const ro = new ResizeObserver(() => { plate = null; rebuild(); drawReveal(); });
  ro.observe(figure);
  if (document.fonts && document.fonts.load) {
    document.fonts.load('16px "Source Sans 3"').then(() => {
      if (!figure.isConnected) return;
      plate = null;
      rebuild();
      drawReveal();
    });
  }
function armLinger() {
  if (opened || sweeping) return;
  clearTimeout(lingerTimer);
  cancelAnimationFrame(dissolveRaf);
  dissolveRaf = 0;
  dissolve = 0;
  figure.style.setProperty("--ring-a", "1");
  lingerTimer = setTimeout(startDissolve, 10000);
}
function startDissolve() {
  if (opened || sweeping) return;
  const t0 = performance.now();
  const dur = reduced ? 0 : 1000;
  const step = now => {
    dissolve = dur ? Math.min(1, (now - t0) / dur) : 1;
    figure.style.setProperty("--ring-a", String(1 - dissolve));
    drawReveal();
    if (dissolve < 1) dissolveRaf = requestAnimationFrame(step);
    else {
      tr = 0;
      r = 0;
      dissolve = 0;
      figure.style.setProperty("--rr", "0px");
      figure.style.setProperty("--ring-a", "1");
      figure.classList.remove("is-live");
      drawReveal();
    }
  };
  cancelAnimationFrame(dissolveRaf);
  dissolveRaf = requestAnimationFrame(step);
}
  
function paint() {
  if (sweeping || opened) { raf = 0; return; }
  const k = reduced ? 1 : 0.35;
  x += (tx - x) * k;
  y += (ty - y) * k;
  r += (tr - r) * (reduced ? 1 : 0.22);
  figure.style.setProperty("--rx", x + "px");
  figure.style.setProperty("--ry", y + "px");
  figure.style.setProperty("--rr", r + "px");
  drawReveal();
  if (!reduced && (Math.abs(tx - x) > 0.4 || Math.abs(ty - y) > 0.4 || Math.abs(tr - r) > 0.4)) {
    raf = requestAnimationFrame(paint);
    return;
  }
  x = tx; y = ty; r = tr;
  figure.style.setProperty("--rx", x + "px");
  figure.style.setProperty("--ry", y + "px");
  figure.style.setProperty("--rr", r + "px");
  drawReveal();
  if (r === 0) figure.classList.remove("is-live");
  raf = 0;
}
  function kick() {
    figure.classList.add("is-live");
    if (!raf) raf = requestAnimationFrame(paint);
  }
  function aim(e) {
    const b = figure.getBoundingClientRect();
    tx = e.clientX - b.left;
    ty = e.clientY - b.top;
  }
  const onEnter = e => {
    if (e.pointerType === "touch" || opened || sweeping) return;
    hovering = true;
    hints.length = 0;
    clearTimeout(hintTimer);
    aim(e); x = tx; y = ty; tr = medium(); kick();
  };
  const onMove = e => {
    if (e.pointerType === "touch" || opened || sweeping) return;
    hovering = true;
    aim(e); tr = medium(); kick();
  };
  const onLeave = e => {
    if (e.pointerType === "touch" || opened || sweeping) return;
    hovering = false;
    tr = 0; kick();
    scheduleHint();
  };
  const onDown = e => {
    if (e.pointerType === "mouse" || opened || sweeping) return;
    aim(e); x = tx; y = ty; tr = medium(); kick();
  };
  const onClick = e => {
    if (sweeping) return;
    hovering = false;
    hints.length = 0;
    clearTimeout(hintTimer);
    clearTimeout(lingerTimer);
    if (!opened) {
      aim(e);
      x = tx; y = ty; r = Math.max(r, 8);
      opened = true;
      figure.classList.add("is-open");
      sweepTo(coverRadius(tx, ty), tx, ty);
    } else {
      opened = false;
      figure.classList.remove("is-open");
      sweepTo(0, x, y, () => {
        r = 0; tr = 0;
        figure.style.setProperty("--rr", "0px");
        figure.classList.remove("is-live");
        drawReveal();
        scheduleHint();
      });
    }
  };
  figure.addEventListener("pointerenter", onEnter);
  figure.addEventListener("pointermove", onMove);
  figure.addEventListener("pointerleave", onLeave);
  figure.addEventListener("pointerdown", onDown);
  figure.addEventListener("click", onClick);
  scheduleHint();

  heroCleanup = () => {
    clearTimeout(hintTimer);
    cancelAnimationFrame(hintRaf);
    stopSweep();
    figure.removeEventListener("pointerenter", onEnter);
    figure.removeEventListener("pointermove", onMove);
    figure.removeEventListener("pointerleave", onLeave);
    figure.removeEventListener("pointerdown", onDown);
    figure.classList.remove("is-live");
    figure.removeEventListener("click", onClick);
    figure.classList.remove("is-open"); 
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
