# Chrome Web Store listing — copy & answers

Paste these into the Developer Dashboard fields. Edit to taste.

## Name (max 45 chars)

YouTube: Don't Recommend Channel

## Summary (max 132 chars)

Block any YouTube channel while you're watching — one click hides all its
videos and tells YouTube to stop recommending it.

## Description

Watching a video and realise it's lazy AI-generated slop? YouTube makes blocking
a channel weirdly hard — the "Don't recommend channel" option is buried in the
3-dots menu on a thumbnail, and it's not even available on the page for the video
you're actually watching.

This extension fixes that. While watching, just hit the "🚫 Don't recommend"
button next to Subscribe (or press Shift+B). That channel is:

• Hidden instantly — every video from it disappears from your home feed, watch
  sidebar, search results, and Shorts, permanently, until you unblock it.
• Reported to YouTube — the extension also fires YouTube's own "Don't recommend
  channel" feedback in the background, so YouTube's algorithm learns too (this is
  optional and can be turned off).

Manage your blocklist from the toolbar popup: view and unblock channels, rebind
the keyboard shortcut, and export/import your list as JSON.

Everything is stored locally in your browser. No accounts, no tracking, no data
sent to the developer.

## Category

Productivity

## Single purpose (required)

Let users block YouTube channels while watching and hide those channels' videos
across YouTube.

## Permission justifications (required)

- storage: Save the user's list of blocked channels and their settings locally.
- Host permission (https://www.youtube.com/*): Add the block button to the watch
  page, hide videos from blocked channels, and (optionally) trigger YouTube's
  native "Don't recommend channel" feedback.

## Data usage disclosures (check these)

- Does NOT collect or use user data. (Certify: no selling, no unrelated use, no
  creditworthiness use.)

## Assets checklist

- [x] Icon 128×128 (icons/icon128.png)
- [ ] Screenshot(s) 1280×800 or 640×400 — at least one. Suggested shots:
      1. A watch page with the "🚫 Don't recommend" button next to Subscribe.
      2. The popup showing a few blocked channels + settings.
- [ ] Privacy policy URL (host PRIVACY.md somewhere public, e.g. a GitHub repo).
- [ ] (Optional) Small promo tile 440×280.
