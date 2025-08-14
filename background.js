// Manifest V3 service worker for Streak

const STORAGE_KEYS = {
  trackedSites: "trackedSites",
  visitsBySiteId: "visitsBySiteId",
  motivations: "motivations",
  allowUntilBySiteId: "allowUntilBySiteId",
  lastVisitAtBySiteId: "lastVisitAtBySiteId"
};

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toUrl(value) {
  try {
    return new URL(value);
  } catch (err) {
    return null;
  }
}

function doesUrlMatchPattern(urlString, pattern, isRegex) {
  if (!urlString || !pattern) return false;
  if (isRegex) {
    try {
      const regex = new RegExp(pattern, "i");
      return regex.test(urlString);
    } catch (err) {
      return false;
    }
  }
  // Non-regex: match either hostname or full URL substring
  const parsed = toUrl(urlString);
  if (!parsed) return false;
  const loweredPattern = pattern.toLowerCase();
  return (
    parsed.hostname.toLowerCase().includes(loweredPattern) ||
    urlString.toLowerCase().includes(loweredPattern)
  );
}

async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

async function ensureInitialData() {
  const data = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId, STORAGE_KEYS.motivations, STORAGE_KEYS.allowUntilBySiteId, STORAGE_KEYS.lastVisitAtBySiteId]);
  let { trackedSites, visitsBySiteId, motivations, allowUntilBySiteId, lastVisitAtBySiteId } = data;

  let didChange = false;

  if (!Array.isArray(trackedSites)) {
    const nowIso = new Date().toISOString();
    trackedSites = [
      {
        id: "yt",
        label: "YouTube",
        pattern: "youtube.com",
        isRegex: false,
        blockMode: "off",
        redirectUrl: "",
        createdAt: nowIso
      },
      {
        id: "nf",
        label: "Netflix",
        pattern: "netflix.com",
        isRegex: false,
        blockMode: "off",
        redirectUrl: "",
        createdAt: nowIso
      }
    ];
    didChange = true;
  }

  if (typeof visitsBySiteId !== "object" || visitsBySiteId === null) {
    visitsBySiteId = {};
    didChange = true;
  }

  if (!Array.isArray(motivations)) {
    motivations = [];
    didChange = true;
  }

  if (typeof allowUntilBySiteId !== "object" || allowUntilBySiteId === null) {
    allowUntilBySiteId = {};
    didChange = true;
  }

  if (typeof lastVisitAtBySiteId !== "object" || lastVisitAtBySiteId === null) {
    lastVisitAtBySiteId = {};
    didChange = true;
  }

  if (didChange) {
    await storageSet({ [STORAGE_KEYS.trackedSites]: trackedSites, [STORAGE_KEYS.visitsBySiteId]: visitsBySiteId, [STORAGE_KEYS.motivations]: motivations, [STORAGE_KEYS.allowUntilBySiteId]: allowUntilBySiteId, [STORAGE_KEYS.lastVisitAtBySiteId]: lastVisitAtBySiteId });
  }
}

async function recordVisitIfTracked(url) {
  const { trackedSites, visitsBySiteId, lastVisitAtBySiteId } = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId, STORAGE_KEYS.lastVisitAtBySiteId]);
  if (!Array.isArray(trackedSites)) return;

  const todayKey = getTodayKey();
  let didRecord = false;
  const lastMap = (typeof lastVisitAtBySiteId === "object" && lastVisitAtBySiteId !== null) ? lastVisitAtBySiteId : {};

  for (const site of trackedSites) {
    if (doesUrlMatchPattern(url, site.pattern, Boolean(site.isRegex))) {
      const key = site.id;
      const existing = Array.isArray(visitsBySiteId?.[key]) ? new Set(visitsBySiteId[key]) : new Set();
      if (!existing.has(todayKey)) {
        existing.add(todayKey);
        if (!visitsBySiteId || typeof visitsBySiteId !== "object") {
          // Guard in case storage was malformed
          visitsBySiteId = {};
        }
        visitsBySiteId[key] = Array.from(existing);
        didRecord = true;
      }
      // Always stamp last visit moment
      lastMap[key] = Date.now();
    }
  }

  if (didRecord) {
    await storageSet({ [STORAGE_KEYS.visitsBySiteId]: visitsBySiteId, [STORAGE_KEYS.lastVisitAtBySiteId]: lastMap });
    await refreshBadgeForToday();
  } else {
    // If only lastMap changed
    await storageSet({ [STORAGE_KEYS.lastVisitAtBySiteId]: lastMap });
  }
}

async function refreshBadgeForToday() {
  const { trackedSites, visitsBySiteId } = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.visitsBySiteId]);
  const todayKey = getTodayKey();

  let anyVisitedToday = false;
  if (Array.isArray(trackedSites)) {
    for (const site of trackedSites) {
      const days = new Set(Array.isArray(visitsBySiteId?.[site.id]) ? visitsBySiteId[site.id] : []);
      if (days.has(todayKey)) {
        anyVisitedToday = true;
        break;
      }
    }
  }

  if (anyVisitedToday) {
    chrome.action.setBadgeText({ text: "X" });
    chrome.action.setBadgeBackgroundColor({ color: "#D93025" }); // red
    chrome.action.setTitle({ title: "Visited a tracked site today" });
  } else {
    chrome.action.setBadgeText({ text: "OK" });
    chrome.action.setBadgeBackgroundColor({ color: "#188038" }); // green
    chrome.action.setTitle({ title: "Clean today" });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialData();
  await refreshBadgeForToday();
  await rebuildDnrRulesFromTracked();
});

// Also refresh badge when the worker starts up
refreshBadgeForToday();

// Only consider main frame commits to avoid noisy iframe matches
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url) return;
  await recordVisitIfTracked(details.url);
});

// Capture SPA-style navigations (history.pushState / replaceState)
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url) return;
  await recordVisitIfTracked(details.url);
});

// Fallback for completed navigations
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (!details.url) return;
  await recordVisitIfTracked(details.url);
});

// --- Blocking/Redirect via Declarative Net Request ---

function buildUrlFilterForSite(site) {
  // For DNR we need URLFilter patterns. We'll keep it simple:
  // - If regex: skip DNR for this entry (can't express arbitrary regex easily)
  // - Else: generate a substring match
  if (site.isRegex) return null;
  const pattern = site.pattern?.trim();
  if (!pattern) return null;
  // Ensure it matches both http and https
  return pattern;
}

function makeRuleIdForSite(siteId, suffix) {
  // DNR rule ids must be positive integers. We'll hash the siteId.
  let hash = 0;
  for (let i = 0; i < siteId.length; i += 1) {
    hash = (hash * 31 + siteId.charCodeAt(i)) >>> 0;
  }
  // Suffix 1 for block, 2 for redirect
  return (hash % 2147483647) + (suffix === 2 ? 100000 : 0);
}

async function rebuildDnrRulesFromTracked() {
  const { trackedSites, allowUntilBySiteId } = await storageGet([STORAGE_KEYS.trackedSites, STORAGE_KEYS.allowUntilBySiteId]);
  if (!Array.isArray(trackedSites)) return;

  const addRules = [];
  const removeRuleIds = [];

  // Start clean: remove all existing dynamic rules to avoid stale conflicts
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    for (const r of existing) removeRuleIds.push(r.id);
  } catch (err) {
    // ignore
  }

  const now = Date.now();
  for (const site of trackedSites) {
    const filter = buildUrlFilterForSite(site);
    const mode = site.blockMode || "off";
    if (!filter || mode === "off") {
      // remove any rules that might exist for this site
      removeRuleIds.push(makeRuleIdForSite(site.id, 1));
      removeRuleIds.push(makeRuleIdForSite(site.id, 2));
      continue;
    }

    // If temporarily allowed, skip adding any rule for this site
    const allowUntil = allowUntilBySiteId?.[site.id];
    if (typeof allowUntil === "number" && allowUntil > now) {
      // ensure any previous rules are removed
      removeRuleIds.push(makeRuleIdForSite(site.id, 1));
      removeRuleIds.push(makeRuleIdForSite(site.id, 2));
      continue;
    }

    if (mode === "block") {
      addRules.push({
        id: makeRuleIdForSite(site.id, 1),
        priority: 1, // lower than redirect
        action: { type: "block" },
        condition: {
          urlFilter: filter,
          resourceTypes: ["main_frame"]
        }
      });
      // ensure redirect rule for same site won't linger
      removeRuleIds.push(makeRuleIdForSite(site.id, 2));
    } else if (mode === "redirect") {
      const target = site.redirectUrl?.trim();
      // If a custom redirect URL is provided (http/https), use it; otherwise redirect to our own blocked page URL
      const builtInUrl = chrome.runtime.getURL('blocked.html');
      const redirectUrl = (target && /^https?:\/\//i.test(target)) ? target : builtInUrl;
      const redirectAction = { type: "redirect", redirect: { url: redirectUrl } };
      addRules.push({
        id: makeRuleIdForSite(site.id, 2),
        priority: 100, // ensure redirect beats any block rule
        action: redirectAction,
        condition: {
          urlFilter: filter,
          resourceTypes: ["main_frame"]
        }
      });
      // remove block rule if any
      removeRuleIds.push(makeRuleIdForSite(site.id, 1));
    }
  }

  // Apply updates
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (err) {
    // ignore errors silently to avoid breaking tracking
  }
}

// Allow expiry using alarms
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "allowSiteTemporarily" && msg.siteId && msg.allowUntil) {
    (async () => {
      const data = await storageGet([STORAGE_KEYS.allowUntilBySiteId]);
      const map = typeof data.allowUntilBySiteId === "object" && data.allowUntilBySiteId !== null ? data.allowUntilBySiteId : {};
      map[msg.siteId] = msg.allowUntil;
      await storageSet({ [STORAGE_KEYS.allowUntilBySiteId]: map });
      // schedule alarm
      try {
        if (chrome && chrome.alarms && typeof chrome.alarms.create === 'function') {
          const when = Math.max(Date.now() + 1000, Number(msg.allowUntil));
          chrome.alarms.create(`allow-expire-${msg.siteId}`, { when });
        }
      } catch (_) {
        // ignore; alarms not available
      }
      await rebuildDnrRulesFromTracked();
      sendResponse({ ok: true });
    })();
    return true; // async response
  }
});

try {
  if (chrome && chrome.alarms && chrome.alarms.onAlarm && typeof chrome.alarms.onAlarm.addListener === 'function') {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (!alarm || !alarm.name || !alarm.name.startsWith("allow-expire-")) return;
      const siteId = alarm.name.replace("allow-expire-", "");
      const data = await storageGet([STORAGE_KEYS.allowUntilBySiteId]);
      const map = typeof data.allowUntilBySiteId === "object" && data.allowUntilBySiteId !== null ? data.allowUntilBySiteId : {};
      const now = Date.now();
      if (typeof map[siteId] === "number" && map[siteId] <= now) {
        delete map[siteId];
        await storageSet({ [STORAGE_KEYS.allowUntilBySiteId]: map });
      }
      await rebuildDnrRulesFromTracked();
    });
  }
} catch (_) {
  // ignore; alarms not available in this context
}

// Rebuild rules when tracked sites change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.trackedSites]) {
    rebuildDnrRulesFromTracked();
  }
});

