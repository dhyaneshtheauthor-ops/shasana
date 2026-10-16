let DATA = [];
let TEMPLE_OVERRIDES = {}; // You can later load a temples.json here

async function init() {
  try {
    const res = await fetch("data/arie_pandya_chola.json");
    DATA = await res.json();
    populateFilters();
    renderResults(DATA.slice(0, 40));
    document.getElementById("resultsMeta").textContent = `Showing first 40 of ${DATA.length} inscriptions`;
  } catch (e) {
    document.getElementById("results").innerHTML = `<p style="color:#f88">Could not load data. Make sure arie_pandya_chola.json is in the data/ folder.</p>`;
  }

  document.getElementById("searchBtn").onclick = doSearch;
  document.getElementById("q").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
  ["f-dynasty","f-district","f-language","f-type"].forEach(id => {
    document.getElementById(id).onchange = doSearch;
  });
}

function populateFilters() {
  const dynasties = [...new Set(DATA.map(d => d.dynasty_normalized).filter(Boolean))].sort();
  const districts = [...new Set(DATA.map(d => d.district).filter(Boolean))].sort();
  const languages = [...new Set(DATA.map(d => d.language).filter(Boolean))].sort();

  const dSel = document.getElementById("f-dynasty");
  dynasties.forEach(v => dSel.add(new Option(v, v)));
  const distSel = document.getElementById("f-district");
  districts.forEach(v => distSel.add(new Option(v, v)));
  const langSel = document.getElementById("f-language");
  languages.forEach(v => langSel.add(new Option(v, v)));
}

function doSearch() {
  const q = document.getElementById("q").value.toLowerCase().trim();
  const dynasty = document.getElementById("f-dynasty").value;
  const district = document.getElementById("f-district").value;
  const language = document.getElementById("f-language").value;
  const type = document.getElementById("f-type").value;

  let filtered = DATA.filter(item => {
    const matchesQ = !q || Object.values(item).some(v => String(v).toLowerCase().includes(q));
    const matchesDyn = !dynasty || item.dynasty_normalized === dynasty;
    const matchesDist = !district || item.district === district;
    const matchesLang = !language || item.language === language;
    const matchesType = !type || item.record_type === type;
    return matchesQ && matchesDyn && matchesDist && matchesLang && matchesType;
  });

  document.getElementById("resultsMeta").textContent = `${filtered.length} inscriptions`;
  renderResults(filtered.slice(0, 100));
}

function renderResults(items) {
  const el = document.getElementById("results");
  if (!items.length) {
    el.innerHTML = `<p style="color:var(--text-muted)">No inscriptions found.</p>`;
    return;
  }
  el.innerHTML = items.map(item => `
    <article class="card" onclick="openInscription('${escape(item.arie_id)}')">
      <h3>${item.arie_no || item.arie_id}</h3>
      <div class="meta">${item.king || "—"} · ${item.dynasty_normalized || ""}</div>
      <div class="meta">${item.temple || item.place_raw || ""}</div>
      <div class="tags">
        ${item.district ? `<span class="tag">${item.district}</span>` : ""}
        ${item.language ? `<span class="tag">${item.language}</span>` : ""}
        ${item.record_type ? `<span class="tag">${item.record_type}</span>` : ""}
      </div>
    </article>
  `).join("");
}

function openInscription(id) {
  const item = DATA.find(d => d.arie_id === id);
  if (!item) return;
  // For now, show temple page if temple exists, else just alert details
  if (item.temple) {
    showTemple(item.temple);
  } else {
    alert(`${item.arie_no}\n${item.king}\n${item.remarks || item.place_raw}`);
  }
}

function showHome() {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-home").classList.remove("hidden");
}

function showTemple(name) {
  const inscriptions = DATA.filter(d => d.temple === name);
  const first = inscriptions[0] || {};
  const override = TEMPLE_OVERRIDES[name] || {};

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-temple").classList.remove("hidden");

  const imgSrc = override.image || `images/temples/${slug(name)}.jpg`;
  document.getElementById("templeContent").innerHTML = `
    <div class="detail-header">
      <h1>${name}</h1>
      <div class="sub">${first.district || ""} ${first.state ? "· " + first.state : ""}</div>
    </div>
    <img class="temple-image" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
    <p style="color:var(--text-muted); margin-bottom:12px;">${override.description || "Temple description can be added later."}</p>
    <h3 style="margin-top:20px;">${inscriptions.length} inscriptions</h3>
    <div class="inscription-list">
      ${inscriptions.map(i => `
        <div class="card">
          <h3>${i.arie_no}</h3>
          <div class="meta">${i.king || ""} · ${i.date_raw || ""}</div>
          <div class="meta">${i.exact_location || ""}</div>
          ${i.remarks ? `<p style="margin-top:6px;font-size:14px;">${i.remarks}</p>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function showTemples() {
  const temples = {};
  DATA.forEach(d => {
    if (d.temple) temples[d.temple] = (temples[d.temple] || 0) + 1;
  });
  const sorted = Object.entries(temples).sort((a,b) => b[1]-a[1]);

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-temples").classList.remove("hidden");
  document.getElementById("templesList").innerHTML = sorted.map(([name, count]) => `
    <div class="card" onclick="showTemple('${escape(name)}')">
      <h3>${name}</h3>
      <div class="meta">${count} inscriptions</div>
    </div>
  `).join("");
}

function showDynasties() {
  const dyn = {};
  DATA.forEach(d => {
    if (d.dynasty_normalized) dyn[d.dynasty_normalized] = (dyn[d.dynasty_normalized] || 0) + 1;
  });
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-dynasties").classList.remove("hidden");
  document.getElementById("dynastiesList").innerHTML = Object.entries(dyn).map(([name, count]) => `
    <div class="card" onclick="showDynasty('${name}')">
      <h3>${name}</h3>
      <div class="meta">${count} inscriptions</div>
    </div>
  `).join("");
}

function showDynasty(name) {
  const inscriptions = DATA.filter(d => d.dynasty_normalized === name);
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-dynasty").classList.remove("hidden");
  document.getElementById("dynastyContent").innerHTML = `
    <div class="detail-header">
      <h1>${name} Dynasty</h1>
      <div class="sub">${inscriptions.length} inscriptions</div>
    </div>
    <div class="inscription-list">
      ${inscriptions.slice(0, 200).map(i => `
        <div class="card" onclick="showTemple('${escape(i.temple || "")}')">
          <h3>${i.arie_no}</h3>
          <div class="meta">${i.king || ""} · ${i.temple || i.place_raw || ""}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function escape(s) { return String(s).replace(/'/g, "\\'"); }

init();
