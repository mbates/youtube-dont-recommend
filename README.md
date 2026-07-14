# YouTube: Don't Recommend Channel

A Chromium extension (Chrome / Brave / Edge / Vivaldi) that lets you block a
channel **while you're watching a video** — no digging through the 3-dots menu
on a thumbnail.

Watching something and realise it's lazy AI slop? Hit the **🚫 Don't recommend**
button next to Subscribe. The channel is added to your blocklist and every video
from it disappears from your home feed, watch sidebar, search results, and
shorts — instantly and permanently, until you unblock it.

## Block while watching — two ways

- **Button:** hit **🚫 Don't recommend** next to Subscribe.
- **Keyboard shortcut:** press **Shift+B** (rebindable in the popup) — no reaching
  for the mouse.

## What blocking does (hybrid: hide + tell YouTube)

Blocking a channel does **both** of these:

1. **Hard local hide (instant).** The channel goes on a local blocklist and every
   video from it is hidden from your home feed, watch sidebar, search, and shorts
   — immediately and permanently, until you unblock it. This is a curtain painted
   over YouTube in your browser; it's instant and never leaks the channel back in.
2. **Native "Don't recommend channel" (background).** As that channel's videos
   surface in your feed/sidebar, the extension drives YouTube's *own* 3-dot menu
   to fire the real "Don't recommend channel" feedback — so **YouTube's algorithm
   itself** learns to deprioritize the channel on your account, everywhere (not
   just in this browser). The transient menu popup is visually suppressed, so you
   don't see menus flashing.

The native step is what YouTube's own feature does, but it's normally buried in a
thumbnail's 3-dot menu and never available on the watch page. You can turn the
native step off in the popup (leaving pure local hiding) with the **"Also tell
YouTube"** toggle.

Channels are matched by both `@handle` and `UC…` channel ID, so a channel stays
blocked even if it's linked differently in different places.

## Install (unpacked)

1. Open `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder.
4. Open any YouTube video — a **🚫 Don't recommend** button appears next to
   Subscribe.

## Managing your blocklist

Click the extension's toolbar icon to:

- See every blocked channel (newest first) and jump to its page.
- Unblock a channel (× button) — its videos reappear immediately.
- Toggle **"Also tell YouTube"** (native feedback) on/off.
- Rebind the keyboard **Shortcut** (click it, then press your combo).
- **Export** / **Import** your list as JSON, or **Clear all**.

## How it works

- `content.js` runs on `youtube.com`, injects the watch-page button, and hides
  any video renderer whose channel link matches the blocklist. A
  `MutationObserver` plus YouTube's `yt-navigate-finish` events keep it working
  through the site's single-page navigation and infinite scroll.
- The blocklist lives in `chrome.storage.local`.

## Notes / limits

- The **hide** step is purely local (nothing leaves your browser). The **native
  feedback** step uses YouTube's own menu action, so it does talk to YouTube —
  that's the point of it. Turn it off with the "Also tell YouTube" toggle if you
  want hiding only.
- Native feedback only fires as a blocked channel's videos actually appear in
  your feed/sidebar (that's where YouTube's feedback token lives). It's driven
  one menu at a time and matches the menu item by the text "…recommend channel",
  so it currently targets **English** YouTube.
- YouTube changes its DOM often. If the button stops appearing, videos stop
  hiding, or native feedback stops firing, the CSS selectors in `content.js` may
  need a refresh.
