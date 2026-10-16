let DATA = [];

async function init() {
  try {
    const res = await fetch("data/arie_pandya_chola.json");
    DATA = await res.json();
    populateFilters();
    renderResults(DATA.slice(0, 40));
    document.getElementById("resultsMeta").textContent = `Showing first 40 of ${DATA.length} inscriptions`;
  } catch (e) {
    document.getElementById("results").innerHTML = `<p style="color:#f88">Could not load data.</p>`;
    console.error(e);
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
    const matchesQ = !q || Object.values(item).some(v => String(v || "").toLowerCase().includes(q));
    const matchesDyn = !dynasty || item.dynasty_normalized === dynasty;
    const matchesDist = !district || item.district === district;
    const matchesLang = !language || (item.language || "").includes(language);
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
      <div class="meta">${formatTemple(item)}</div>
      <div class="tags">
        ${item.district ? `<span class="tag">${item.district}</span>` : ""}
        ${item.language ? `<span class="tag">${item.language}</span>` : ""}
      </div>
    </article>
  `).join("");
}

function formatTemple(item) {
  const parts = [item.temple, item.temple_place, item.district ? item.district + " District" : "", item.state].filter(Boolean);
  return parts.join(", ") || item.place_raw || "";
}

function openInscription(id) {
  const item = DATA.find(d => d.arie_id === id);
  if (!item) return;
  if (item.temple) showTemple(item.temple);
  else alert(`${item.arie_no}\n${item.king}\n${item.exact_location || item.place_raw}`);
}

function showHome() {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-home").classList.remove("hidden");
}

function showTemple(name) {
  const inscriptions = DATA.filter(d => d.temple === name);
  if (!inscriptions.length) return;
  const first = inscriptions[0];

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-temple").classList.remove("hidden");

  const title = [first.temple, first.temple_place, first.district ? first.district + " District" : "", first.state].filter(Boolean).join(", ");
  const imgSrc = `images/temples/${slug(name)}.jpg`;

  document.getElementById("templeContent").innerHTML = `
    <div class="detail-header">
      <h1>${title}</h1>
      <div class="sub">${inscriptions.length} inscriptions</div>
      ${first.latitude ? `<div class="sub">Coordinates: ${first.latitude}, ${first.longitude}</div>` : ""}
    </div>
    <img class="temple-image" src="${imgSrc}" alt="${name}" onerror="this.style.display='none'">
    <div class="search-panel" style="margin-top:16px;">
      <input type="text" id="templeSearch" placeholder="Filter inscriptions in this temple…" style="width:100%;padding:10px;border-radius:8px;background:var(--bg);border:1px solid var(--border);color:var(--text);">
    </div>
    <div id="templeInscriptions" class="inscription-list"></div>
  `;

  function renderTempleInscriptions(list) {
    document.getElementById("templeInscriptions").innerHTML = list.map(i => `
      <div class="card">
        <h3>${i.arie_no}</h3>
        <div class="meta">${i.king || ""} · ${i.dynasty_normalized || ""} · ${i.date_raw || ""}</div>
        <div class="meta"><strong>Location:</strong> ${i.exact_location || "—"}</div>
        ${i.remarks ? `<p style="margin-top:6px;font-size:14px;">${i.remarks}</p>` : ""}
      </div>
    `).join("");
  }

  renderTempleInscriptions(inscriptions);
  document.getElementById("templeSearch").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = inscriptions.filter(i => 
      Object.values(i).some(v => String(v || "").toLowerCase().includes(q))
    );
    renderTempleInscriptions(filtered);
  };
}

function showTemples() {
  const temples = {};
  DATA.forEach(d => {
    if (d.temple && d.temple.length > 3 && !d.temple.toLowerCase().startsWith("on ")) {
      temples[d.temple] = temples[d.temple] || { count: 0, sample: d };
      temples[d.temple].count++;
    }
  });
  const sorted = Object.entries(temples).sort((a,b) => b[1].count - a[1].count);

  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById("view-temples").classList.remove("hidden");
  document.getElementById("templesList").innerHTML = sorted.map(([name, info]) => {
    const s = info.sample;
    const label = [s.temple, s.temple_place, s.district ? s.district + " District" : "", s.state].filter(Boolean).join(", ");
    return `
      <div class="card" onclick="showTemple('${escape(name)}')">
        <h3>${label}</h3>
        <div class="meta">${info.count} inscriptions</div>
      </div>
    `;
  }).join("");
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
          <div class="meta">${i.king || ""} · ${formatTemple(i)}</div>
          <div class="meta">${i.exact_location || ""}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function escape(s) { return String(s).replace(/'/g, "\\'"); }

init();
