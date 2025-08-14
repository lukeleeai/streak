const STORAGE_KEYS = {
  trackedSites: "trackedSites",
  visitsBySiteId: "visitsBySiteId",
  motivations: "motivations",
  lastVisitAtBySiteId: "lastVisitAtBySiteId",
  logs: "logs"
};

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function daysBetween(dateA, dateB) {
  const ms = startOfDay(dateB) - startOfDay(dateA);
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function computeCurrentStreak(site, visitsSet) {
  // If visited today, streak is 0
  const todayKey = getTodayKey();
  if (visitsSet.has(todayKey)) return 0;

  // Find most recent visit date
  let mostRecentVisit = null;
  for (const v of visitsSet) {
    if (!mostRecentVisit || v > mostRecentVisit) {
      mostRecentVisit = v;
    }
  }

  if (!mostRecentVisit) {
    // Never visited; count days since tracking started
    const createdAt = site.createdAt ? new Date(site.createdAt) : new Date();
    // Include today as day 1 of the clean streak
    // I want to start the streak at 3 days, so I add 2 to the days between createdAt and today
    return Math.max(1, daysBetween(createdAt, new Date()) + 1) + 2;  
  }

  const lastVisitDate = new Date(mostRecentVisit + "T00:00:00");
  // Streak is the number of days since last visit including today
  const delta = daysBetween(lastVisitDate, new Date());
  return Math.max(1, delta);
}

function lastNDates(n) {
  const dates = [];
  const today = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
  }
  return dates;
}

function updateClockAndProgress() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const timeString = `${displayHours}:${String(minutes).padStart(2,'0')} ${ampm}`;
  const timeEl = document.getElementById('current-time');
  if (timeEl) timeEl.textContent = timeString;

  const totalMinutes = hours * 60 + minutes;
  const dayProgress = (totalMinutes / 1440) * 100;
  const displayProgress = Math.min(99.99, dayProgress).toFixed(2);
  const progEl = document.getElementById('day-progress');
  if (progEl) progEl.textContent = `${displayProgress}% complete`;

  const ratio = Math.max(0.02, Math.min(0.999, totalMinutes / 1440));

  document.querySelectorAll('.day-circle.today, .today-mini, .yg-cell.today').forEach(el => {
    el.style.setProperty('--progress-ratio', ratio);
  });

  // Update hours/minutes label live
  const labelEl = document.getElementById('streak-label');
  if (labelEl && window.__streakBaselineMs) {
    const msDiff = Date.now() - window.__streakBaselineMs;
    if (msDiff > 0) {
      const hours = Math.floor(msDiff / (60 * 60 * 1000)) + 24;
      const minutes = Math.floor((msDiff % (60 * 60 * 1000)) / (60 * 1000));
      const seconds = Math.floor((msDiff % (60 * 1000)) / 1000);
      labelEl.textContent = `day streak • ${hours}h ${minutes}m ${seconds}s saved`;
    }
  }
}

function renderTop(trackedSites, visitsBySiteId, lastVisitAtBySiteId) {
  // Time and day progress
  updateClockAndProgress();
  setInterval(updateClockAndProgress, 1000);

  // Overall streak = min streak across all sites (cleanest constraint)
  // Exclude sites created today to avoid resetting the streak when adding new sites
  let overall = Infinity;
  let mostRecentVisit = null;
  const todayKey = getTodayKey();
  for (const site of trackedSites) {
    const set = new Set(visitsBySiteId?.[site.id] || []);
    
    // Skip sites created today to preserve existing streak
    const createdAt = site.createdAt ? new Date(site.createdAt) : new Date();
    const createdToday = getTodayKey(createdAt) === todayKey;
    
    const s = computeCurrentStreak(site, set);
    if (!createdToday) {
      overall = Math.min(overall, s);
    }
    
    for (const v of set) {
      if (!mostRecentVisit || v > mostRecentVisit) mostRecentVisit = v;
    }
  }
  if (!isFinite(overall)) overall = 0;
  document.getElementById('total-streak').textContent = String(overall);

  // Append hours/minutes since last visit if any (computed from last visit day at midnight)
  const labelEl = document.getElementById('streak-label');
  let baselineMs = null;
  // Prefer precise lastVisit map if present
  if (lastVisitAtBySiteId && typeof lastVisitAtBySiteId === 'object') {
    for (const k of Object.keys(lastVisitAtBySiteId)) {
      const v = Number(lastVisitAtBySiteId[k]);
      if (!isNaN(v)) baselineMs = Math.max(baselineMs ?? 0, v);
    }
  }
  // Fallback to last day at midnight
  if (!baselineMs && mostRecentVisit) {
    baselineMs = new Date(mostRecentVisit + 'T00:00:00').getTime();
  }
  // Fallback to earliest tracking start
  if (!baselineMs) {
    let earliest = null;
    for (const s of trackedSites) {
      if (s.createdAt) {
        const t = new Date(s.createdAt).getTime();
        earliest = earliest ? Math.min(earliest, t) : t;
      }
    }
    baselineMs = earliest ?? Date.now();
  }
  window.__streakBaselineMs = baselineMs;
  const ms = Date.now() - baselineMs;
  const hours = Math.max(0, Math.floor(ms / (60 * 60 * 1000)));
  const minutes = Math.max(0, Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000)));
  const seconds = Math.max(0, Math.floor((ms % (60 * 1000)) / 1000));
  labelEl.textContent = `day streak • ${hours}h ${minutes}m ${seconds}s`;
  
  // Rolling calendar since earliest tracking date → today
  const container = document.getElementById('week-calendar');
  container.innerHTML = '';
  const today = new Date();
  // find earliest createdAt among sites, default to today if none
  let earliest = new Date(today);
  for (const site of trackedSites) {
    if (site.createdAt) {
      const d = new Date(site.createdAt);
      if (d < earliest) earliest = d;
    }
  }
  earliest = startOfDay(earliest);

  const cursor = new Date(earliest);
  const end = startOfDay(today);
  while (cursor <= end) {
    const key = getTodayKey(cursor);
    let anyVisited = false;
    for (const site of trackedSites) {
      const set = new Set(visitsBySiteId?.[site.id] || []);
      if (set.has(key)) { anyVisited = true; break; }
    }
    const dayDiv = document.createElement('div');
    dayDiv.className = 'day-container';
    const circle = document.createElement('div');
    circle.className = 'day-circle';
    if (key === getTodayKey(end)) {
      circle.classList.add('today');
    } else {
      circle.classList.add(anyVisited ? 'incomplete' : 'completed');
      if (!anyVisited) circle.textContent = '✓';
    }
    dayDiv.appendChild(circle);
    container.appendChild(dayDiv);
    cursor.setDate(cursor.getDate() + 1);
  }
  // ensure progress ring is applied to the just-created today circle
  updateClockAndProgress();
}

function renderPlatforms(trackedSites, visitsBySiteId) {
  // Platforms view removed per request
}

function renderYearGrid(trackedSites, visitsBySiteId) {
  const grid = document.getElementById('year-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const start = new Date('2025-08-09T00:00:00');
  const end = new Date('2025-12-31T00:00:00');
  const today = startOfDay(new Date());

  const dayKeysVisitedOverall = new Set();
  for (const site of trackedSites) {
    const list = Array.isArray(visitsBySiteId?.[site.id]) ? visitsBySiteId[site.id] : [];
    for (const d of list) dayKeysVisitedOverall.add(d);
  }

  // We want earliest date at top-left, proceeding left-to-right, wrapping to next row
  const cursor = startOfDay(start);
  while (cursor <= end) {
    const key = getTodayKey(cursor);
    const cell = document.createElement('div');
    cell.className = 'yg-cell';
    const isFuture = cursor > today;
    const isToday = key === getTodayKey(today);
    if (isFuture) {
      cell.classList.add('locked');
      cell.setAttribute('data-title', `${key} — locked`);
    } else if (isToday) {
      cell.classList.add('today');
      cell.setAttribute('data-title', `${key} — today`);
    } else {
      const visited = dayKeysVisitedOverall.has(key);
      cell.classList.add(visited ? 'fail' : 'success');
      cell.setAttribute('data-title', `${key} — ${visited ? 'visited' : 'clean'}`);
    }
    grid.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
  // Ensure today appears at the very first position: earliest at top-left already satisfies
}

function renderMotivation(motivations) {
  const el = document.getElementById('motivation');
  el.hidden = true;
  if (!Array.isArray(motivations) || motivations.length === 0) return;
  const idx = Math.floor(Math.random() * motivations.length);
  el.textContent = motivations[idx];
  el.hidden = false;
}

function formatDateTime(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function renderLogs(logs) {
  const container = document.getElementById('logs');
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(logs) || logs.length === 0) return;
  logs.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'log-item';
    const meta = document.createElement('div');
    meta.className = 'log-meta';
    meta.textContent = formatDateTime(item.ts || Date.now());
    const txt = document.createElement('div');
    txt.className = 'log-text';
    txt.textContent = item.text;
    wrap.appendChild(meta);
    wrap.appendChild(txt);
    const del = document.createElement('button');
    del.className = 'log-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const copy = [...logs];
      copy.splice(idx, 1);
      await new Promise((r) => chrome.storage.local.set({ [STORAGE_KEYS.logs]: copy }, r));
      logs.splice(0, logs.length, ...copy);
      renderLogs(logs);
    });
    wrap.appendChild(del);

    // Long hover: after 1s, show delete
    let hoverTimer = null;
    wrap.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => {
        wrap.classList.add('show-delete');
      }, 1000);
    });
    wrap.addEventListener('mouseleave', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      wrap.classList.remove('show-delete');
    });
    container.appendChild(wrap);
  });
}

function setupLogForm(initialLogs) {
  const logs = Array.isArray(initialLogs) ? initialLogs : [];
  renderLogs(logs);
  const form = document.getElementById('logForm');
  const input = document.getElementById('logInput');
  if (!form || !input) return;
  const syncReady = () => {
    const hasText = input.value.trim().length > 0;
    form.classList.toggle('ready', hasText);
  };
  input.addEventListener('input', syncReady);
  syncReady();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const entry = { ts: Date.now(), text };
    const updated = [entry, ...logs];
    await new Promise((r) => chrome.storage.local.set({ [STORAGE_KEYS.logs]: updated }, r));
    logs.splice(0, logs.length, ...updated);
    renderLogs(logs);
    input.value = '';
    syncReady();
  });
}

async function init() {
  const data = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId, STORAGE_KEYS.motivations, STORAGE_KEYS.lastVisitAtBySiteId, STORAGE_KEYS.logs]);
  const trackedSites = Array.isArray(data.trackedSites) ? data.trackedSites : [];
  const visitsBySiteId = typeof data.visitsBySiteId === "object" && data.visitsBySiteId !== null ? data.visitsBySiteId : {};
  const motivations = Array.isArray(data.motivations) ? data.motivations : [];
  const lastVisitAtBySiteId = (typeof data.lastVisitAtBySiteId === 'object' && data.lastVisitAtBySiteId !== null) ? data.lastVisitAtBySiteId : {};
  const logs = Array.isArray(data.logs) ? data.logs : [];

  renderTop(trackedSites, visitsBySiteId, lastVisitAtBySiteId);
  renderMotivation(motivations);
  renderYearGrid(trackedSites, visitsBySiteId);
  setupLogForm(logs);

  document.getElementById("manageBtn").addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open("options.html");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);

