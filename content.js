/* YouTube: Don't Recommend Channel
 * - Injects a "Don't recommend" button on the watch page (next to Subscribe).
 * - Hides all videos from blocked channels across home, sidebar, search, shorts.
 * - Survives YouTube's SPA navigation via a MutationObserver.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "blockedChannels";
  const SETTINGS_KEY = "settings";

  // In-memory mirror of the blocklist.
  //   entries: [{ keys: string[], name: string, addedAt: number }]
  //   blockSet: Set<string> — union of all keys for O(1) matching.
  let entries = [];
  let blockSet = new Set(); // union of channel keys (handle/id/legacy)
  let blockNames = new Set(); // normalized display names, for link-less cards

  // User settings, mirrored from storage.
  //   nativeFeedback: also fire YouTube's own "Don't recommend channel".
  //   shortcut: keyboard combo to block the current channel on the watch page.
  const DEFAULT_SETTINGS = {
    nativeFeedback: true,
    shortcut: { key: "b", shift: true, alt: false, ctrl: false, meta: false },
  };
  let settings = { ...DEFAULT_SETTINGS };

  // Every video-card element type we scan. Current YouTube renders most feed and
  // sidebar cards as <yt-lockup-view-model>; the ytd-* tags cover older surfaces
  // and layouts still in rotation.
  const CARD_SELECTOR = [
    "yt-lockup-view-model",
    "ytd-rich-item-renderer",
    "ytd-compact-video-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-compact-radio-renderer",
    "ytd-reel-item-renderer",
  ].join(",");

  // A channel link inside a card (when present — sidebar lockups omit it).
  const CHANNEL_LINK_SELECTOR =
    'a[href^="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]';

  // Where a card's channel NAME text lives, across old and new layouts.
  const CHANNEL_NAME_SELECTOR =
    "ytd-channel-name #text, ytd-channel-name a, " +
    "yt-content-metadata-view-model .ytContentMetadataViewModelMetadataRow";

  // "More actions" 3-dot trigger, new (button-view-model) and legacy (ytd-menu).
  const MENU_TRIGGER_SELECTOR =
    'button[aria-label="More actions"], yt-icon-button.dropdown-trigger, ' +
    "ytd-menu-renderer yt-icon-button#button, ytd-menu-renderer #button";

  function normalizeName(s) {
    return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  /* ------------------------------------------------------------------ */
  /* Channel key normalization                                          */
  /* ------------------------------------------------------------------ */

  // Turn a channel href into a stable, comparable key. Returns null if the
  // href isn't a channel link (e.g. a /watch or /playlist link).
  function channelKeyFromHref(href) {
    if (!href) return null;
    let path;
    try {
      path = new URL(href, location.origin).pathname;
    } catch {
      return null;
    }
    let m;
    if ((m = path.match(/^\/channel\/(UC[\w-]+)/))) return "id:" + m[1];
    if ((m = path.match(/^\/(@[\w.\-]+)/))) return "handle:" + m[1].toLowerCase();
    if ((m = path.match(/^\/(?:c|user)\/([\w.\-]+)/)))
      return "legacy:" + m[1].toLowerCase();
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Storage                                                            */
  /* ------------------------------------------------------------------ */

  function rebuildSet() {
    blockSet = new Set();
    blockNames = new Set();
    for (const e of entries) {
      for (const k of e.keys) blockSet.add(k);
      const n = normalizeName(e.name);
      if (n) blockNames.add(n);
    }
  }

  function loadState() {
    chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY], (res) => {
      entries = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
      settings = { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
      rebuildSet();
      scanAndHide();
    });
  }

  function saveBlocklist() {
    chrome.storage.local.set({ [STORAGE_KEY]: entries });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SETTINGS_KEY]) {
      settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
    }
    if (changes[STORAGE_KEY]) {
      entries = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
      rebuildSet();
      // Blocklist changed: re-arm the circuit breaker and re-evaluate every
      // card. nativeAttempted intentionally PERSISTS across the page session so
      // blocking one channel never re-fires native feedback for channels we've
      // already signalled (that was a source of redundant menu-driving).
      nativeCircuitOpen = false;
      for (const el of document.querySelectorAll("[data-ydr-hidden]")) {
        el.style.display = "";
        el.removeAttribute("data-ydr-hidden");
        el.__ydrQueued = false;
        el.__ydrDone = false;
      }
      // Also clear the done-marker on still-visible cards so unblock re-checks.
      for (const el of document.querySelectorAll(CARD_SELECTOR)) {
        el.__ydrDone = false;
      }
      scanAndHide();
    }
  });

  function isBlocked(keys) {
    for (const k of keys) if (blockSet.has(k)) return true;
    return false;
  }

  function addChannel(keys, name) {
    keys = keys.filter(Boolean);
    if (!keys.length) return false;
    // Merge into an existing entry if any key already known.
    let entry = entries.find((e) => e.keys.some((k) => keys.includes(k)));
    if (entry) {
      const merged = new Set([...entry.keys, ...keys]);
      entry.keys = [...merged];
      if (name) entry.name = name;
    } else {
      entries.push({ keys, name: name || keys[0], addedAt: Date.now() });
    }
    rebuildSet();
    saveBlocklist();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Hiding blocked videos                                              */
  /* ------------------------------------------------------------------ */

  // Identify a card's channel. Prefer the channel link's key (authoritative);
  // otherwise fall back to the visible channel-name text (sidebar lockups have
  // no link). Returns { key, name } — either may be null/empty.
  function cardChannel(card) {
    const a = card.querySelector(CHANNEL_LINK_SELECTOR);
    const key = a ? channelKeyFromHref(a.getAttribute("href")) : null;
    const nameEl = card.querySelector(CHANNEL_NAME_SELECTOR);
    const name = nameEl ? nameEl.textContent.trim() : "";
    return { key, name };
  }

  // Is this card from a blocked channel? A card with a real channel key is
  // matched only on that key (so same-named-but-different channels aren't
  // wrongly hidden); a link-less card falls back to its channel-name text.
  function cardIsBlocked(card) {
    const { key, name } = cardChannel(card);
    if (key) return blockSet.has(key);
    return blockNames.has(normalizeName(name));
  }

  // A stable per-channel string used to fire native feedback at most once per
  // channel (prevents the refetch cascade that native feedback would otherwise
  // trigger — one "Don't recommend" makes YouTube refill recs with more of the
  // same channel, which must NOT trigger another "Don't recommend").
  function channelIdentity(card) {
    const { key, name } = cardChannel(card);
    return key || (name ? "name:" + normalizeName(name) : null);
  }

  // What we actually collapse. Hide the grid wrapper when present so the layout
  // doesn't leave an empty cell; otherwise the card itself.
  function hideTarget(card) {
    return card.closest("ytd-rich-item-renderer, ytd-rich-grid-media") || card;
  }

  function hideContainer(container) {
    if (!container || container.hasAttribute("data-ydr-hidden")) return;
    container.style.display = "none";
    container.setAttribute("data-ydr-hidden", "1");
  }

  function scanAndHide(root = document) {
    if (!blockSet.size && !blockNames.size) return;
    const cards = root.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      if (card.__ydrDone) continue;
      if (!cardIsBlocked(card)) continue;
      const ident = channelIdentity(card);
      card.__ydrDone = true; // never touch this card again in later scans

      // Fire YouTube's native feedback at most ONCE per channel (the first card
      // we see keeps its menu driven; every other card — including ones YouTube
      // refetches afterwards — is just hidden locally). This is what prevents
      // the feedback→refetch→feedback refresh loop.
      if (
        settings.nativeFeedback &&
        ident &&
        !nativeAttempted.has(ident) &&
        !nativeCircuitOpen &&
        hasDrivableMenu(card)
      ) {
        nativeAttempted.add(ident);
        queueNativeFeedback(card); // drives the menu, then hides the card
      } else {
        hideContainer(hideTarget(card));
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Native "Don't recommend channel" (drive YouTube's own menu)        */
  /* ------------------------------------------------------------------ */

  const feedbackQueue = [];
  let feedbackBusy = false;

  // Channels we've already fired native feedback for this page-session.
  let nativeAttempted = new Set();
  // Circuit breaker: if native feedback somehow fires too often, disable it for
  // the rest of the page so a runaway loop can never lock up the tab.
  let nativeCircuitOpen = false;
  const nativeDriveTimes = [];
  function recordNativeDrive() {
    const now = Date.now();
    nativeDriveTimes.push(now);
    while (nativeDriveTimes.length && now - nativeDriveTimes[0] > 15000) {
      nativeDriveTimes.shift();
    }
    if (nativeDriveTimes.length > 12) {
      nativeCircuitOpen = true;
      feedbackQueue.length = 0;
      console.warn(
        "[Don't Recommend] Native feedback paused for this page (too many actions in a short time)."
      );
    }
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function hasDrivableMenu(container) {
    return !!container.querySelector(MENU_TRIGGER_SELECTOR);
  }

  function queueNativeFeedback(container) {
    if (!container || container.__ydrQueued) return;
    container.__ydrQueued = true;
    feedbackQueue.push(container);
    drainFeedbackQueue();
  }

  async function drainFeedbackQueue() {
    if (feedbackBusy) return;
    feedbackBusy = true;
    try {
      while (feedbackQueue.length) {
        if (nativeCircuitOpen) break;
        const container = feedbackQueue.shift();
        if (!container.isConnected) continue;
        recordNativeDrive();
        let ok = false;
        try {
          ok = await driveDontRecommend(container);
        } catch {
          /* swallow — fall through to fallback hide */
        }
        // If YouTube didn't remove it (item missing / already gone), hide it.
        if (container.isConnected) hideContainer(hideTarget(container));
        if (ok) await delay(250); // gap between menu drives
      }
    } finally {
      feedbackBusy = false;
    }
  }

  function openMenuItems() {
    const dd = document.querySelector(
      'ytd-popup-container tp-yt-iron-dropdown:not([aria-hidden="true"])'
    );
    const scope = dd || document;
    return scope.querySelectorAll(
      "yt-list-item-view-model, ytd-menu-service-item-renderer, " +
        "ytd-menu-service-item-download-renderer, tp-yt-paper-item, " +
        '[role="menuitem"]'
    );
  }

  function findDontRecommendItem() {
    for (const it of openMenuItems()) {
      const t = (it.textContent || "").trim().toLowerCase();
      // Matches "Don't recommend channel" across straight/curly apostrophes
      // and localized word order.
      if (t.includes("recommend channel")) return it;
    }
    return null;
  }

  function closeOpenMenu() {
    const dd = document.querySelector(
      'ytd-popup-container tp-yt-iron-dropdown:not([aria-hidden="true"])'
    );
    const target = dd || document.body;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        keyCode: 27,
        which: 27,
        bubbles: true,
      })
    );
    const backdrop = document.querySelector(
      "tp-yt-iron-overlay-backdrop.opened"
    );
    if (backdrop) backdrop.click();
  }

  async function driveDontRecommend(container) {
    const trigger = container.querySelector(MENU_TRIGGER_SELECTOR);
    if (!trigger) return false;

    document.documentElement.setAttribute("data-ydr-driving", "1");
    try {
      trigger.click();

      let item = null;
      for (let i = 0; i < 20 && !item; i++) {
        await delay(50);
        item = findDontRecommendItem();
      }

      if (item) {
        item.click();
        await delay(80); // let YouTube send feedback + remove the renderer
        return true;
      }
      closeOpenMenu();
      return false;
    } finally {
      document.documentElement.removeAttribute("data-ydr-driving");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Watch-page button                                                  */
  /* ------------------------------------------------------------------ */

  // Collect every identifying key for the channel of the current watch page.
  function currentWatchChannel() {
    const keys = new Set();
    let name = "";

    const ownerLink = document.querySelector(
      "ytd-video-owner-renderer a.yt-simple-endpoint[href], " +
        "#owner #channel-name a[href], " +
        "ytd-watch-metadata #owner a[href]"
    );
    if (ownerLink) {
      const k = channelKeyFromHref(ownerLink.getAttribute("href"));
      if (k) keys.add(k);
    }

    const nameEl = document.querySelector(
      "ytd-video-owner-renderer #channel-name a, #owner #channel-name a"
    );
    if (nameEl) name = nameEl.textContent.trim();

    // Canonical channel id, if present in page metadata.
    const authorLink = document.querySelector(
      'span[itemprop="author"] link[itemprop="url"], link[itemprop="url"][href*="/channel/"]'
    );
    if (authorLink) {
      const k = channelKeyFromHref(authorLink.getAttribute("href"));
      if (k) keys.add(k);
    }

    return { keys: [...keys], name };
  }

  // Block the channel of the current watch page. Shared by the button and the
  // keyboard shortcut. Returns true if a channel was identified.
  function blockCurrentChannel() {
    const { keys, name } = currentWatchChannel();
    if (!keys.length) {
      toast("Couldn't identify this channel — try again in a second.");
      return false;
    }
    const alreadyBlocked = isBlocked(keys);
    addChannel(keys, name);
    refreshButtonState();
    toast(
      alreadyBlocked
        ? `${name || "Channel"} is already blocked.`
        : settings.nativeFeedback
        ? `Blocked ${name || "channel"} — hiding it and telling YouTube.`
        : `Blocked ${name || "channel"} — hiding its videos.`
    );
    scanAndHide();
    return true;
  }

  function makeButton() {
    const btn = document.createElement("button");
    btn.id = "ydr-block-btn";
    btn.type = "button";
    btn.className = "ydr-block-btn";
    // Build with DOM methods — YouTube enforces Trusted Types, which forbids
    // innerHTML assignment on this document.
    const ico = document.createElement("span");
    ico.className = "ydr-ico";
    ico.textContent = "🚫";
    const lbl = document.createElement("span");
    lbl.className = "ydr-label";
    lbl.textContent = "Don't recommend";
    btn.append(ico, lbl);
    btn.title = "Block this channel and hide its videos everywhere";
    btn.addEventListener("click", blockCurrentChannel);
    return btn;
  }

  function injectWatchButton() {
    if (!location.pathname.startsWith("/watch")) return;
    if (document.getElementById("ydr-block-btn")) {
      refreshButtonState();
      return;
    }
    // Insert right after the Subscribe button in the owner row.
    const subscribe = document.querySelector(
      "ytd-watch-metadata #owner #subscribe-button, ytd-video-owner-renderer #subscribe-button"
    );
    if (subscribe && subscribe.parentElement) {
      subscribe.parentElement.insertBefore(makeButton(), subscribe.nextSibling);
      refreshButtonState();
    }
  }

  function refreshButtonState() {
    const btn = document.getElementById("ydr-block-btn");
    if (!btn) return;
    const { keys } = currentWatchChannel();
    const blocked = isBlocked(keys);
    btn.classList.toggle("ydr-blocked", blocked);
    btn.querySelector(".ydr-label").textContent = blocked
      ? "Blocked"
      : "Don't recommend";
    btn.title = blocked
      ? "Channel blocked — manage in the extension popup"
      : `Block this channel and hide its videos everywhere (${shortcutLabel()})`;
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                              */
  /* ------------------------------------------------------------------ */

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById("ydr-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ydr-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("ydr-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("ydr-show"), 3000);
  }

  /* ------------------------------------------------------------------ */
  /* Keyboard shortcut                                                  */
  /* ------------------------------------------------------------------ */

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable
    );
  }

  function shortcutLabel() {
    const s = settings.shortcut || DEFAULT_SETTINGS.shortcut;
    const parts = [];
    if (s.ctrl) parts.push("Ctrl");
    if (s.alt) parts.push("Alt");
    if (s.shift) parts.push("Shift");
    if (s.meta) parts.push("Meta");
    parts.push((s.key || "").toUpperCase());
    return parts.join("+");
  }

  function onKeyDown(e) {
    const s = settings.shortcut;
    if (!s || !s.key) return;
    if (isTypingTarget(e.target)) return;
    if (
      e.key.toLowerCase() !== s.key.toLowerCase() ||
      e.shiftKey !== !!s.shift ||
      e.altKey !== !!s.alt ||
      e.ctrlKey !== !!s.ctrl ||
      e.metaKey !== !!s.meta
    ) {
      return;
    }
    if (!location.pathname.startsWith("/watch")) return;
    e.preventDefault();
    e.stopPropagation();
    blockCurrentChannel();
  }

  /* ------------------------------------------------------------------ */
  /* Wiring: observe DOM + SPA navigation                               */
  /* ------------------------------------------------------------------ */

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanAndHide();
      injectWatchButton();
    });
  }

  function start() {
    loadState();

    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // YouTube SPA navigation events.
    window.addEventListener("yt-navigate-finish", scheduleScan);
    window.addEventListener("yt-page-data-updated", scheduleScan);

    // Keyboard shortcut (capture phase so YouTube's own handlers don't eat it).
    window.addEventListener("keydown", onKeyDown, true);

    scheduleScan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
