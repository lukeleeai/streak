const STORAGE_KEYS = {
  trackedSites: "trackedSites",
  visitsBySiteId: "visitsBySiteId",
  motivations: "motivations"
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
    return Math.max(1, daysBetween(createdAt, new Date()) + 1);
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
  document.querySelectorAll('.day-circle.today, .today-mini').forEach(el => {
    el.style.setProperty('--progress-ratio', ratio);
  });
}

function renderTop(trackedSites, visitsBySiteId) {
  // Time and day progress
  updateClockAndProgress();
  setInterval(updateClockAndProgress, 60000);

  // Overall streak = min streak across all sites (cleanest constraint)
  let overall = Infinity;
  const todayKey = getTodayKey();
  for (const site of trackedSites) {
    const set = new Set(visitsBySiteId?.[site.id] || []);
    const s = computeCurrentStreak(site, set);
    overall = Math.min(overall, s);
  }
  if (!isFinite(overall)) overall = 0;
  document.getElementById('total-streak').textContent = String(overall);

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
  const root = document.getElementById('platforms');
  root.innerHTML = '';

  const today = new Date();
  // For each site, rolling mini days from site.createdAt (or today) to today

  for (const site of trackedSites) {
    const visitSet = new Set(visitsBySiteId?.[site.id] || []);
    const streak = computeCurrentStreak(site, visitSet);

    const section = document.createElement('div');
    section.className = 'platform-section';

    const header = document.createElement('div');
    header.className = 'platform-header';
    const name = document.createElement('div');
    name.className = 'platform-name';
    const icon = document.createElement('div');
    icon.className = 'platform-icon';
    icon.textContent = '😈';
    name.appendChild(icon);
    name.appendChild(document.createTextNode(site.label || site.pattern));
    const streakEl = document.createElement('div');
    streakEl.className = 'platform-streak';
    streakEl.textContent = `${streak} day${streak === 1 ? '' : 's'}`;
    header.appendChild(name);
    header.appendChild(streakEl);

    const mini = document.createElement('div');
    mini.className = 'mini-calendar';
    const sStart = site.createdAt ? startOfDay(new Date(site.createdAt)) : startOfDay(today);
    const cur = new Date(sStart);
    const end = startOfDay(today);
    while (cur <= end) {
      const key = getTodayKey(cur);
      const dot = document.createElement('div');
      dot.className = 'mini-day';
      if (key === getTodayKey(end)) {
        dot.classList.add('today-mini');
      } else {
        dot.classList.add(visitSet.has(key) ? 'visited' : 'clean');
      }
      mini.appendChild(dot);
      cur.setDate(cur.getDate() + 1);
    }

    section.appendChild(header);
    section.appendChild(mini);
    root.appendChild(section);
  }
  // apply current progress to today's mini dots as well
  updateClockAndProgress();
}

function renderMotivation(motivations) {
  const el = document.getElementById('motivation');
  el.hidden = true;
  if (!Array.isArray(motivations) || motivations.length === 0) return;
  const idx = Math.floor(Math.random() * motivations.length);
  el.textContent = motivations[idx];
  el.hidden = false;
}

async function init() {
  const data = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId, STORAGE_KEYS.motivations]);
  const trackedSites = Array.isArray(data.trackedSites) ? data.trackedSites : [];
  const visitsBySiteId = typeof data.visitsBySiteId === "object" && data.visitsBySiteId !== null ? data.visitsBySiteId : {};
  const motivations = Array.isArray(data.motivations) ? data.motivations : [];

  renderTop(trackedSites, visitsBySiteId);
  renderMotivation(motivations);
  renderPlatforms(trackedSites, visitsBySiteId);

  document.getElementById("manageBtn").addEventListener("click", () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open("options.html");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);

