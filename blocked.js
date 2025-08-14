const STORAGE_KEYS = {
  motivations: "motivations",
  trackedSites: "trackedSites"
};

async function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function identifySiteId(url) {
  // best-effort: match current hostname to a site's pattern (non-regex only)
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return host;
  } catch { return null; }
}

function matchSiteIdByUrl(trackedSites, currentUrl) {
  for (const site of trackedSites) {
    if (site.isRegex) continue;
    if (!site.pattern) continue;
    const lower = site.pattern.toLowerCase();
    if (currentUrl.toLowerCase().includes(lower)) return site.id;
  }
  return null;
}

async function init() {
  const data = await storageGet([STORAGE_KEYS.motivations, STORAGE_KEYS.trackedSites]);
  const list = Array.isArray(data.motivations) ? data.motivations : [];
  const el = document.getElementById('phrase');
  if (list.length === 0) {
    el.textContent = 'You got this! One clean day at a time.';
  } else {
    el.textContent = pickRandom(list);
  }

  document.getElementById('backBtn').addEventListener('click', () => {
    history.back();
  });
  document.getElementById('manageBtn').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('options.html');
    }
  });

  const siteId = matchSiteIdByUrl(Array.isArray(data.trackedSites) ? data.trackedSites : [], document.referrer || '');
  const bypassBtn = document.getElementById('bypassBtn');
  bypassBtn.addEventListener('click', async () => {
    const step1 = confirm('Do you really, really need to open this?');
    if (!step1) return;
    const step2 = confirm('Are you absolutely sure?');
    if (!step2) return;
    const step3 = confirm('Last chance. You will have 3 minutes only. Proceed?');
    if (!step3) return;
    const siteToAllow = siteId || (Array.isArray(data.trackedSites) && data.trackedSites[0]?.id);
    if (!siteToAllow) return;
    const allowUntil = Date.now() + 3 * 60 * 1000;
    await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'allowSiteTemporarily', siteId: siteToAllow, allowUntil }, resolve));
    // After allowing, try to go back to the original page
    if (document.referrer) {
      location.href = document.referrer;
    } else {
      history.back();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

