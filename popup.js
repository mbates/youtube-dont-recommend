const STORAGE_KEY = "blockedChannels";
const SETTINGS_KEY = "settings";

const DEFAULT_SETTINGS = {
  nativeFeedback: true,
  shortcut: { key: "b", shift: true, alt: false, ctrl: false, meta: false },
};

const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const countEl = document.getElementById("count");

function get(cb) {
  chrome.storage.local.get(STORAGE_KEY, (res) =>
    cb(Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [])
  );
}
function set(entries, cb) {
  chrome.storage.local.set({ [STORAGE_KEY]: entries }, cb);
}

// Build a channel URL from the entry's keys so the user can jump to it.
function channelUrl(entry) {
  for (const k of entry.keys) {
    if (k.startsWith("handle:")) return "https://www.youtube.com/" + k.slice(7);
    if (k.startsWith("id:"))
      return "https://www.youtube.com/channel/" + k.slice(3);
    if (k.startsWith("legacy:"))
      return "https://www.youtube.com/c/" + k.slice(7);
  }
  return "https://www.youtube.com/";
}

function keyLabel(entry) {
  const handle = entry.keys.find((k) => k.startsWith("handle:"));
  if (handle) return handle.slice(7);
  const id = entry.keys.find((k) => k.startsWith("id:"));
  if (id) return id.slice(3);
  return entry.keys[0] || "";
}

function render(entries) {
  entries.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  countEl.textContent = String(entries.length);
  listEl.innerHTML = "";
  emptyEl.hidden = entries.length > 0;

  entries.forEach((entry, i) => {
    const li = document.createElement("li");

    const name = document.createElement("div");
    name.className = "name";
    const a = document.createElement("a");
    a.href = channelUrl(entry);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = entry.name || keyLabel(entry);
    name.appendChild(a);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = keyLabel(entry);
    name.appendChild(meta);

    const rm = document.createElement("button");
    rm.className = "remove";
    rm.textContent = "×";
    rm.title = "Unblock";
    rm.addEventListener("click", () => {
      get((cur) => {
        cur.splice(i, 1);
        set(cur, () => render(cur));
      });
    });

    li.appendChild(name);
    li.appendChild(rm);
    listEl.appendChild(li);
  });
}

document.getElementById("clear").addEventListener("click", () => {
  if (confirm("Unblock all channels?")) set([], () => render([]));
});

document.getElementById("export").addEventListener("click", () => {
  get((entries) => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blocked-channels.json";
    a.click();
    URL.revokeObjectURL(url);
  });
});

const importFile = document.getElementById("import-file");
document
  .getElementById("import")
  .addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("bad format");
      get((cur) => {
        const seen = new Set(cur.flatMap((e) => e.keys));
        for (const e of imported) {
          if (!e || !Array.isArray(e.keys)) continue;
          if (e.keys.some((k) => seen.has(k))) continue;
          e.keys.forEach((k) => seen.add(k));
          cur.push(e);
        }
        set(cur, () => render(cur));
      });
    } catch {
      alert("Couldn't read that file.");
    }
  };
  reader.readAsText(file);
  importFile.value = "";
});

/* -------------------------------------------------------------------- */
/* Settings: native feedback toggle + shortcut rebinding                */
/* -------------------------------------------------------------------- */

const nativeEl = document.getElementById("native");
const shortcutEl = document.getElementById("shortcut");
let settings = { ...DEFAULT_SETTINGS };

function shortcutLabel(s) {
  const parts = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.alt) parts.push("Alt");
  if (s.shift) parts.push("Shift");
  if (s.meta) parts.push("Meta");
  parts.push((s.key || "").toUpperCase());
  return parts.join("+");
}

function saveSettings() {
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function loadSettings() {
  chrome.storage.local.get(SETTINGS_KEY, (res) => {
    settings = { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
    nativeEl.checked = settings.nativeFeedback !== false;
    shortcutEl.textContent = shortcutLabel(settings.shortcut);
  });
}

nativeEl.addEventListener("change", () => {
  settings.nativeFeedback = nativeEl.checked;
  saveSettings();
});

let recording = false;
shortcutEl.addEventListener("click", () => {
  recording = !recording;
  shortcutEl.classList.toggle("recording", recording);
  shortcutEl.textContent = recording ? "Press keys…" : shortcutLabel(settings.shortcut);
});

document.addEventListener("keydown", (e) => {
  if (!recording) return;
  e.preventDefault();
  // Ignore lone modifier presses; wait for a real key.
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
  if (e.key === "Escape") {
    recording = false;
    shortcutEl.classList.remove("recording");
    shortcutEl.textContent = shortcutLabel(settings.shortcut);
    return;
  }
  settings.shortcut = {
    key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
    shift: e.shiftKey,
    alt: e.altKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
  };
  saveSettings();
  recording = false;
  shortcutEl.classList.remove("recording");
  shortcutEl.textContent = shortcutLabel(settings.shortcut);
});

get(render);
loadSettings();
