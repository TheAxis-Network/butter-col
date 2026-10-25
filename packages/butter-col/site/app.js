// butter-col frontend: a launcher plus an in-page browser around the
// proxied site. Everything proxy-related goes through ButterController.
import { ButterController } from "/butter/controller.mjs";

const $ = (selector) => document.querySelector(selector);

// ---- preferences (per browser, best effort) ----------------------------------

const PREFS_KEY = "butter-col:frontend";
const defaults = { searchEngine: "https://duckduckgo.com/?q=%s", theme: "system", recent: [] };

function loadPrefs() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}
const prefs = loadPrefs();
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable (private mode): preferences last for this visit only
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}
applyTheme();

// ---- elements ---------------------------------------------------------------

const home = $("#home");
const browser = $("#browser");
const frame = $("#frame");
const homeForm = $("#home-form");
const homeInput = $("#home-input");
const homeNotice = $("#home-notice");
const addressForm = $("#address-form");
const addressInput = $("#address-input");
const addressLock = $("#address-lock");
const progress = $("#progress");
const settings = $("#settings");
const settingsNotice = $("#settings-notice");
const transportSelect = $("#setting-transport");
const transportName = $("#transport-name");

function showNotice(element, text, kind = "error") {
  element.textContent = text;
  element.dataset.kind = kind;
  element.hidden = !text;
}

// ---- butter-col ------------------------------------------------------------------

const butter = new ButterController({ searchEngine: prefs.searchEngine });
const ready = butter.init().then(refreshTransport, (err) => {
  showNotice(homeNotice, explain(err));
  homeForm.querySelector("button").disabled = true;
  transportName.textContent = "nothing yet";
  throw err;
});

function explain(err) {
  const message = String((err && err.message) || err);
  if (/no service workers/i.test(message)) {
    return "This browser has service workers turned off, so butter-col can't run here. Private windows often turn them off; try a normal window.";
  }
  if (/HTTPS/i.test(message)) {
    return "butter-col needs a secure connection. Open this page over https:// (or on localhost).";
  }
  return message;
}

async function refreshTransport() {
  const { active, available } = await butter.getTransport();
  transportName.textContent = active.name;
  transportSelect.replaceChildren(
    ...available.map((t) => {
      const option = new Option(t.loaded ? t.name : `${t.name} (didn't load)`, t.name, false, t.name === active.name);
      option.disabled = !t.loaded;
      return option;
    }),
  );
  transportSelect.disabled = available.length < 2;
}

// ---- recent sites ---------------------------------------------------------------

function remember(url, title) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  prefs.recent = [{ url, title: title || host, host }, ...prefs.recent.filter((r) => r.url !== url)].slice(0, 8);
  savePrefs();
  renderRecent();
}

function renderRecent() {
  const list = $("#recent-list");
  list.replaceChildren(
    ...prefs.recent.map((item) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => open(item.url));
      const badge = document.createElement("span");
      badge.className = "recent-badge";
      badge.textContent = item.host.replace(/^www\./, "").charAt(0) || "?";
      const title = document.createElement("span");
      title.className = "recent-title";
      title.textContent = item.title;
      const host = document.createElement("span");
      host.className = "recent-host";
      host.textContent = item.host;
      button.append(badge, title, host);
      li.append(button);
      return li;
    }),
  );
  $("#recent-empty").hidden = prefs.recent.length > 0;
}
renderRecent();

// ---- browsing ---------------------------------------------------------------------

let current = "";      // target URL currently shown in the frame
let watcher = 0;

function setLoading(loading) {
  progress.dataset.state = loading ? "loading" : "done";
}

function showAddress(url) {
  current = url;
  if (document.activeElement !== addressInput) addressInput.value = url;
  const insecure = url.startsWith("http:");
  addressLock.toggleAttribute("data-insecure", insecure);
  addressLock.setAttribute("aria-label", insecure ? "Not encrypted" : "Encrypted");
}

async function open(input) {
  const value = String(input || "").trim();
  if (!value) return;
  try {
    await ready;
  } catch {
    return;
  }
  const url = butter.resolveInput(value);
  home.hidden = true;
  browser.hidden = false;
  showAddress(url);
  setLoading(true);
  frame.src = butter.encodeUrl(url);
  history.replaceState(null, "", "#" + encodeURIComponent(url));
  if (!watcher) watcher = setInterval(watchFrame, 500);
}

function goHome() {
  clearInterval(watcher);
  watcher = 0;
  frame.src = "about:blank";
  current = "";
  browser.hidden = true;
  home.hidden = false;
  document.title = "butter-col";
  history.replaceState(null, "", location.pathname + location.search);
  homeInput.select();
  homeInput.focus();
}

/** The proxied page's real URL, or null while it isn't readable. */
function frameUrl() {
  try {
    const href = frame.contentWindow.location.href;
    if (!href || href === "about:blank") return null;
    const target = butter.decodeUrl(href);
    return target === href ? null : target;
  } catch {
    return null;
  }
}

// Single-page apps change their URL without loading: keep the address bar in step.
function watchFrame() {
  const url = frameUrl();
  if (url && url !== current) {
    showAddress(url);
    history.replaceState(null, "", "#" + encodeURIComponent(url));
  }
}

frame.addEventListener("load", () => {
  setLoading(false);
  const url = frameUrl();
  if (!url) return;
  showAddress(url);
  let title = "";
  try {
    title = frame.contentDocument.title;
    // Show the progress bar again as soon as the page starts leaving.
    frame.contentWindow.addEventListener("pagehide", () => setLoading(true), { once: true });
  } catch {
    // not readable
  }
  document.title = title ? `${title} - butter-col` : "butter-col";
  remember(url, title);
});

// ---- controls -----------------------------------------------------------------

homeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  open(homeInput.value);
});

addressForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addressInput.blur();
  open(addressInput.value);
});
addressInput.addEventListener("focus", () => addressInput.select());
addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    addressInput.value = current;
    addressInput.blur();
  }
});

function openBlankTab() {
  const tab = window.open("about:blank", "_blank");
  if (!tab) {
    showNotice(settingsNotice, "Your browser blocked the new tab. Allow pop-ups for this site and try again.");
    return;
  }
  const doc = tab.document;
  doc.title = "about:blank";
  const style = doc.createElement("style");
  style.textContent = "html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}";
  const embed = doc.createElement("iframe");
  embed.src = location.href;
  embed.allow = "fullscreen; clipboard-read; clipboard-write; autoplay; picture-in-picture";
  doc.head.append(style);
  doc.body.append(embed);
  showNotice(settingsNotice, "Opened in a new about:blank tab.", "info");
}

const actions = {
  back: () => frame.contentWindow?.history.back(),
  forward: () => frame.contentWindow?.history.forward(),
  reload: () => {
    setLoading(true);
    try {
      frame.contentWindow.location.reload();
    } catch {
      frame.src = frame.src;
    }
  },
  home: goHome,
  fullscreen: () => frame.requestFullscreen?.().catch(() => {}),
  popout: () => {
    if (current) window.open(butter.encodeUrl(current), "_blank", "noopener");
  },
  settings: () => {
    showNotice(settingsNotice, "");
    refreshTransport().catch(() => {});
    settings.showModal();
  },
  blank: openBlankTab,
  "clear-recent": () => {
    prefs.recent = [];
    savePrefs();
    renderRecent();
    showNotice(settingsNotice, "Recent sites cleared.", "info");
  },
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button && actions[button.dataset.action]) actions[button.dataset.action]();
});

// Settings
const searchSelect = $("#setting-search");
const themeSelect = $("#setting-theme");
searchSelect.value = prefs.searchEngine;
themeSelect.value = prefs.theme;

searchSelect.addEventListener("change", () => {
  prefs.searchEngine = searchSelect.value;
  butter.options.searchEngine = searchSelect.value;
  savePrefs();
});
themeSelect.addEventListener("change", () => {
  prefs.theme = themeSelect.value;
  savePrefs();
  applyTheme();
});
transportSelect.addEventListener("change", async () => {
  try {
    const active = await butter.setTransport(transportSelect.value);
    transportName.textContent = active.name;
    showNotice(settingsNotice, `Now browsing through ${active.name}. Pages already open switch when they reload.`, "info");
  } catch (err) {
    showNotice(settingsNotice, String((err && err.message) || err));
    refreshTransport().catch(() => {});
  }
});

// Keyboard: "/" focuses the search box at home; Ctrl/Cmd+L or F6 the address bar.
document.addEventListener("keydown", (event) => {
  const typing = event.target.closest?.("input, select, textarea");
  if (!browser.hidden && (event.key === "F6" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l"))) {
    event.preventDefault();
    addressInput.focus();
  } else if (browser.hidden && event.key === "/" && !typing) {
    event.preventDefault();
    homeInput.focus();
  }
});

// Reopen what was open before a reload (#<url>).
if (location.hash.length > 1) {
  try {
    open(decodeURIComponent(location.hash.slice(1)));
  } catch {
    // malformed hash: stay home
  }
}
