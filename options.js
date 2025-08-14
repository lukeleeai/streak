const STORAGE_KEYS = {
  trackedSites: "trackedSites",
  visitsBySiteId: "visitsBySiteId",
  motivations: "motivations"
};

async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function generateId(prefix = "site") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${random}`;
}

function renderList(trackedSites, visitsBySiteId) {
  const list = document.getElementById("list");
  list.innerHTML = "";

  if (!Array.isArray(trackedSites) || trackedSites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No sites tracked yet. Add some above.";
    list.appendChild(empty);
    return;
  }

  for (const site of trackedSites) {
    const item = document.createElement("div");
    item.className = "item";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "item-title";
    title.textContent = site.label || site.pattern;
    const sub = document.createElement("div");
    sub.className = "muted";
    sub.textContent = `${site.isRegex ? "Regex" : "Pattern"}: ${site.pattern}`;
    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "row";
    // Block/redirect controls
    const modeSel = document.createElement("select");
    [
      { v: "off", l: "Off" },
      { v: "block", l: "Block" },
      { v: "redirect", l: "Redirect" }
    ].forEach(({ v, l }) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = l;
      if ((site.blockMode || "off") === v) opt.selected = true;
      modeSel.appendChild(opt);
    });
    modeSel.addEventListener("change", async () => {
      const data = await storageGet([STORAGE_KEYS.trackedSites]);
      const arr = Array.isArray(data.trackedSites) ? data.trackedSites : [];
      const idx = arr.findIndex((s) => s.id === site.id);
      if (idx >= 0) {
        arr[idx].blockMode = modeSel.value;
        await storageSet({ [STORAGE_KEYS.trackedSites]: arr });
      }
    });

    const redirectInput = document.createElement("input");
    redirectInput.type = "text";
    redirectInput.placeholder = "https://example.com/redirect";
    redirectInput.value = site.redirectUrl || "";
    redirectInput.addEventListener("change", async () => {
      const data = await storageGet([STORAGE_KEYS.trackedSites]);
      const arr = Array.isArray(data.trackedSites) ? data.trackedSites : [];
      const idx = arr.findIndex((s) => s.id === site.id);
      if (idx >= 0) {
        arr[idx].redirectUrl = redirectInput.value.trim();
        await storageSet({ [STORAGE_KEYS.trackedSites]: arr });
      }
    });
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset visits";
    resetBtn.className = "danger";
    resetBtn.addEventListener("click", async () => {
      const data = await storageGet([STORAGE_KEYS.visitsBySiteId]);
      const map = data.visitsBySiteId || {};
      delete map[site.id];
      await storageSet({ [STORAGE_KEYS.visitsBySiteId]: map });
      await refresh();
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.className = "danger";
    delBtn.addEventListener("click", async () => {
      const newList = trackedSites.filter((s) => s.id !== site.id);
      const data = await storageGet([STORAGE_KEYS.visitsBySiteId]);
      const map = data.visitsBySiteId || {};
      delete map[site.id];
      await storageSet({ [STORAGE_KEYS.trackedSites]: newList, [STORAGE_KEYS.visitsBySiteId]: map });
      await refresh();
    });

    right.appendChild(modeSel);
    right.appendChild(redirectInput);
    right.appendChild(resetBtn);
    right.appendChild(delBtn);

    item.appendChild(left);
    item.appendChild(right);
    list.appendChild(item);
  }
}

async function refresh() {
  const data = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId]);
  const trackedSites = Array.isArray(data.trackedSites) ? data.trackedSites : [];
  const visitsBySiteId = typeof data.visitsBySiteId === "object" && data.visitsBySiteId !== null ? data.visitsBySiteId : {};
  renderList(trackedSites, visitsBySiteId);
}

async function refreshMotivations() {
  const data = await storageGet([STORAGE_KEYS.motivations]);
  const arr = Array.isArray(data.motivations) ? data.motivations : [];
  renderMotivationList(arr);
}

async function addSite(label, pattern, isRegex) {
  const nowIso = new Date().toISOString();
  const data = await storageGet([STORAGE_KEYS.trackedSites]);
  const trackedSites = Array.isArray(data.trackedSites) ? data.trackedSites : [];
  trackedSites.push({ id: generateId(), label, pattern, isRegex: Boolean(isRegex), blockMode: "off", redirectUrl: "", createdAt: nowIso });
  await storageSet({ [STORAGE_KEYS.trackedSites]: trackedSites });
  await refresh();
}

function setupForm() {
  const form = document.getElementById("addForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("label").value.trim();
    const pattern = document.getElementById("pattern").value.trim();
    const isRegex = document.getElementById("isRegex").checked;
    if (!label || !pattern) return;
    await addSite(label, pattern, isRegex);
    form.reset();
  });

  document.getElementById("seedBtn").addEventListener("click", async () => {
    await addSite("YouTube", "youtube.com", false);
    await addSite("Netflix", "netflix.com", false);
  });
}

function setupImportExport() {
  const exportBtn = document.getElementById("exportBtn");
  exportBtn.addEventListener("click", async () => {
    const data = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId, STORAGE_KEYS.motivations]);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `streak-data-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importBtn = document.getElementById("importBtn");
  const fileInput = document.getElementById("importFile");
  importBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      const payload = {};
      if (Array.isArray(json.trackedSites)) payload[STORAGE_KEYS.trackedSites] = json.trackedSites;
      if (json.visitsBySiteId && typeof json.visitsBySiteId === "object") payload[STORAGE_KEYS.visitsBySiteId] = json.visitsBySiteId;
      if (Array.isArray(json.motivations)) payload[STORAGE_KEYS.motivations] = json.motivations;
      if (Object.keys(payload).length > 0) {
        await storageSet(payload);
        await refresh();
        await refreshMotivations();
      }
    } catch (err) {
      alert("Invalid JSON file.");
    }
  });

  const resetVisitsBtn = document.getElementById("resetVisitsBtn");
  resetVisitsBtn.addEventListener("click", async () => {
    if (!confirm("Clear all recorded visit days for all sites?")) return;
    await storageSet({ [STORAGE_KEYS.visitsBySiteId]: {} });
    await refresh();
  });

  const resetAllBtn = document.getElementById("resetAllBtn");
  resetAllBtn.addEventListener("click", async () => {
    if (!confirm("Remove all tracked sites and visits? This cannot be undone.")) return;
    await storageSet({ [STORAGE_KEYS.trackedSites]: [], [STORAGE_KEYS.visitsBySiteId]: {} });
    await refresh();
  });
}

function renderMotivationList(motivations) {
  const list = document.getElementById("motivationsList");
  list.innerHTML = "";
  if (!Array.isArray(motivations) || motivations.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No phrases yet. Add one above.";
    list.appendChild(empty);
    return;
  }
  motivations.forEach((text, index) => {
    const item = document.createElement("div");
    item.className = "item";
    const left = document.createElement("div");
    left.textContent = text;
    const right = document.createElement("div");
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.addEventListener("click", async () => {
      const data = await storageGet([STORAGE_KEYS.motivations]);
      const arr = Array.isArray(data.motivations) ? data.motivations : [];
      arr.splice(index, 1);
      await storageSet({ [STORAGE_KEYS.motivations]: arr });
      await refreshMotivations();
    });
    right.appendChild(del);
    item.appendChild(left);
    item.appendChild(right);
    list.appendChild(item);
  });
}

function setupMotivationForm() {
  const form = document.getElementById("addMotivationForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("motivationText");
    const value = input.value.trim();
    if (!value) return;
    const data = await storageGet([STORAGE_KEYS.motivations]);
    const arr = Array.isArray(data.motivations) ? data.motivations : [];
    arr.push(value);
    await storageSet({ [STORAGE_KEYS.motivations]: arr });
    input.value = "";
    await refreshMotivations();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  setupForm();
  setupImportExport();
  setupMotivationForm();
  await refresh();
  await refreshMotivations();
});

