# pact — Privacy Policy

<!--
OWNER CHECKLIST — delete this comment once every item is done. Search this file for "TODO" to find them all.
  1. Effective date and "last updated" date.
  2. Who is responsible for pact (name or company) and a real contact address (privacy@pact.example is a placeholder).
  3. Where the Supabase project is hosted (region).
  4. Which service sends the email sign-in codes (only matters if WXT_EMAIL_SIGN_IN=true in the published build).
  5. Whether account deletion is in-app yet, how long a request takes, and that uploaded files are removed with it.
  6. Which VibeParty transport the published build uses (Supabase Realtime, or a separate relay set at build time).
  7. Re-read §3 and §6 against the final build — the policy describes the code as it was when it was written.
This file is the single source of truth: the in-extension page (privacy.html) renders it, so edit it here and nowhere else.
-->

**Effective date:** **TODO(owner): effective date, e.g. 2026-12-01** · **Last updated:** **TODO(owner): date**

**Who we are:** **TODO(owner): your name or company** ("we", "us") makes pact, a browser extension that replaces your new-tab page.
**Contact:** **TODO(owner): replace with a real address — privacy@pact.example is a placeholder**

## The short version

- **Without an account, pact stays on your device.** It makes no network requests of its own and has nothing to send to us.
- **If you sign in**, your profile and your notes are stored in your account so they follow you between devices. If you join a Community, your messages and files are stored there for the other members.
- **We don't run ads or analytics, we don't track you, and we never sell your data.** There are no advertising or analytics libraries in pact at all.
- **You're in control.** You can export your data, erase what's on your device, leave communities, and ask us to delete your account.

## 1. What pact is

pact is a new-tab extension for Chrome and other Chromium browsers. It gives you a search box and shortcuts, notes, a task board, a focus timer, small offline tools, chat communities, and a "watch YouTube together" mode. Everything the extension can do is listed in the permission table in §6.

## 2. What stays on your device

Most of pact runs entirely inside your browser. This is stored in your browser's own storage (local storage, IndexedDB and the extension's `storage.local`), on your computer only:

| What | Details |
| --- | --- |
| Home | Your pinned shortcuts, the sites you hid, your recent searches (the last few), your layout, clock and widget choices, your main focus for each day, and the text in the Quick note box |
| Appearance and settings | Theme, accent colour, font, wallpaper (a wallpaper image is kept in IndexedDB and never uploaded), animation and sound preferences |
| Tasks and timer | Your Kanban boards and tasks, focus timer settings and session history |
| Chat demo | **Direct messages and friends are currently a local demo.** The "friends" are simulated on your device; nothing you type there is sent anywhere. |
| Quick capture | The toolbar popup and the **C** shortcut write to the same storage. An unsent draft is kept so a closed popup doesn't lose your words. |
| Tour and tips | Whether you have seen the first-run tour |

Uninstalling the extension removes all of this from your browser. You can also erase it yourself at any time (see §8).

When you use the search box, your search text is handed to **your browser's default search engine**, which handles it under its own privacy policy. pact keeps only your recent searches, on your device.

**Camera.** If you open pact's Camera, your browser asks permission to use your camera (and, only when you record a video with sound switched on, your microphone). The video stays on your device: it is shown in the page, and photos or videos you take are saved in this browser's local storage (IndexedDB; the latest 24, up to 1 GB). pact never uploads, shares or analyses them. The camera and microphone turn off when you close the Camera, switch away from the tab for a while, or close pact. You can delete captures at any time in the Camera, and they are removed if a different account signs in on this device or you use Erase everything. You can withdraw permission in your browser's site settings.

**Your own commands.** Quicklinks, snippets and aliases you create for the search box are stored on your device only (and are part of a backup you export). Nothing about them is sent anywhere; a quicklink only contacts its website when you press Enter on it.

## 3. If you sign in

You can sign in with **GitHub** or **Google**. If email sign-in is switched on in your copy of pact, you can also use a **one-time code sent to your email**. There are no passwords: you sign in on GitHub's or Google's own page and pact never sees your password there.

We run pact's backend on **Supabase** (hosting, database, authentication, file storage, realtime messaging and small server functions). **TODO(owner): hosting region.** pact is not end-to-end encrypted: the people who administer the Supabase project can technically reach stored data, and we only do so to run, secure and debug the service, or when the law requires it.

**Your account.** Supabase keeps what the sign-in provider shares: your email address, a provider ID, and usually your name and avatar link. pact uses your provider name only to suggest a display name.

**Your profile.** Display name, @username, role, bio, and optionally a profile picture. These are visible to the people you share a Community with. An email address you type into your profile is private: only you can read it.

**Profile picture (optional).** It's cropped to a small square on your device and stored in a public image bucket under a random file name. Anyone who has the link can open it; pact only shows the link to people who can see your profile.

**Notes.** Notebooks and notes (titles, text, pins, timestamps) sync to your account so they work offline and appear on your other devices. Only you can read them: access is restricted to your account by row-level security in the database. When you delete a note it is kept in your account marked as deleted, so your other devices learn about the deletion; it isn't shown to anyone and is removed for good when your account is deleted. Signing out removes your notes from this device (they stay in your account).

**Communities.** A Community is a private, invite-only group. If you create or join one, the following is stored for its members:

- the community, its channels and its invites (codes can expire, have a use limit and be revoked);
- your membership and role, and any ban or timeout applied to you;
- your messages, replies and reactions, including images, short videos (up to 25 MB) and links;
- what you have read in each channel (used for unread counts, and visible only to you).

Members can see your display name, @username, role, bio, profile picture and the social links (up to five) you choose to add, and **never your email**. Your email is simply the one your sign-in provided; it can't be edited, and your @username is chosen once during the welcome form and then can't be changed. Attachments live in a private bucket and are opened through short-lived links. Moderators can hide a message; the original is kept so moderators can review or restore it. "Typing…" indicators are sent live to members and are not stored. The admin can delete a community, which deletes its channels, messages and uploaded files.

**GIFs.** The GIF picker sends your search words (or "trending") and a sign-in token to our server function, which asks **KLIPY** for results with pact's key, so KLIPY sees our server, not you. A GIF you post is shared as a link to KLIPY's own copy; when a member's browser displays it, that browser loads the image from KLIPY's servers, and KLIPY sees that request (such as an IP address) under its own policy.

**Discover (news and articles).** When you open Discover while signed in, pact sends the web addresses of the feeds you follow, or have added yourself, to your project's `feeds` Edge Function together with your sign-in token. The function downloads those feeds on pact's behalf (so the publishers see the server's address, not yours), keeps the result in memory for up to 10 minutes, and returns the article titles, summaries, pictures' addresses and, when the publisher includes it, the article text. It does not store what you read or follow. Article pictures are loaded directly from the publishers' servers when you view a story (without a Referer header), so a publisher can see your IP address and that a picture was requested. Opening an article's original page or a link inside it contacts that site in the usual way. The sources you follow, hidden sources, custom feed addresses, the stories you saved (title, summary, link and picture address — not the article text), which stories you have read, and a short-lived cache of the latest headlines are stored on your device only; all of it is removed when a different account signs in or you erase your data.

**Link previews.** When a message contains a link, our server function fetches that page (not your browser) to get a title, description and image, caches the result for about a week, and keeps a copy of the thumbnail in a public image bucket. The linked site sees our server, not you.

**VibeParty (watch together).** On youtube.com, pact reads the state of the video you're watching (playing, paused, position, title) so it can sync with the room. In a *local* party this happens between your own YouTube tabs and never leaves your browser. In a *live* party with other people, the room runs on a private Supabase Realtime channel named after the room code: members receive your display name, playback state, chat messages, reactions and queue. **Nothing is written to a database**; one member's browser acts as host and holds the room's recent chat and queue in memory until the party ends. Anyone with the room code can join, so treat it like a password. **TODO(owner): confirm this is the transport the published build uses; if a separate relay server is configured at build time, state who runs it.** If you open a YouTube link that carries a pact invite, pact offers to join the party (it never joins by itself) and removes the invite from the address bar once it has read it. pact only reads the YouTube page your tab is already on, plus the public page and thumbnails of videos in the queue; it adds no scripts to any other site.

## 4. Who else sees some of your data

| Who | When | What they receive |
| --- | --- | --- |
| Supabase | You are signed in | The data in §3, because they host it |
| GitHub or Google | You choose to sign in with them | The fact that you are signing in to pact. They don't receive your notes or messages |
| KLIPY | You search for or view a GIF | Search words (via our server) and, when you view a GIF, that browser's request |
| YouTube (Google) | You use VibeParty | The ordinary requests your browser already makes to YouTube |
| Your browser's search engine | You search from Home | Your search text |
| Email delivery service | You request an email sign-in code | Your email address. **TODO(owner): name the provider, if email sign-in is enabled** |

We never sell, rent or trade your data, and we don't share it for advertising.

## 5. What pact does not do

- No analytics, telemetry, crash reporting or advertising, and no tracking pixels.
- No third-party scripts or fonts: everything is bundled in the extension, so pact loads nothing from the web to draw your tab.
- No reading of your browsing history beyond your browser's own "most visited" list, which is read on your device to draw Home tiles and never uploaded.
- No content on pages other than youtube.com, and no reading of what you type or view elsewhere.
- No remote code: the extension runs only the code it shipped with.

## 6. Permissions, and why

| Permission | Why pact needs it |
| --- | --- |
| `storage` | Remember VibeParty's display name and panel settings, and keep a party running when the browser pauses the extension's background worker |
| `topSites` | Show your most-visited sites as tiles on Home (read on your device, never uploaded) |
| `favicon` | Draw site icons from the browser's local cache, instead of asking a third-party icon service |
| `search` | Run your Home searches with your default search engine |
| `alarms` | Fire the focus timer even when no pact tab is open |
| `notifications` | Tell you when a focus session or break ends while pact isn't in front |
| `identity` | Open the GitHub or Google sign-in window. It does not give pact access to your browser profile or email |
| `offscreen` | Keep a live VibeParty connection running in a hidden extension page, because the browser stops the background worker when it is idle. The page shows nothing and reads nothing from other sites |
| Access to `www.youtube.com` | The VibeParty panel, and finding an open YouTube tab to start a party in |

Beyond permissions, the extension replaces your new-tab page, adds a toolbar button and an optional keyboard shortcut (you can change it at `chrome://extensions/shortcuts`) that opens the quick-capture popup, and adds the `pact` keyword to the address bar.

## 7. How long we keep things

- Data on your device stays until you erase it or uninstall.
- Account data stays until you delete your account or the thing yourself (a note, a message, a community).
- Link-preview results are cached for about a week before they are refreshed.
- A live VibeParty room exists only while people are in it; its chat and queue are held in memory and aren't stored.

## 8. Your choices

- **Look at and change** your profile any time in Settings.
- **Export** what's on your device: Settings → Your data → Export downloads a backup file (chat attachments aren't included).
- **Erase** what's on your device: Settings → Your data → Erase everything. Notes in your account sync back the next time you sign in.
- **Delete** individual notes, messages, boards and communities whenever you like.
- **Delete your account** and the data in it: **TODO(owner): describe how (an in-app button, or by writing to the contact address), how long it takes, and that uploaded files and community content are removed with it.**
- **Your rights.** Depending on where you live (for example the EU, the UK or California) you may have the right to access, correct, delete, restrict or move your data, or to object to how it is used. Write to the contact address above and we'll respond within the time the law requires. We use your data to provide the service you asked for and to keep it secure.

## 9. Security

Connections use HTTPS. Every table that holds personal data has row-level security, so the database itself enforces that people can only read what they're allowed to. Only a public (publishable) key is bundled in the extension; no secret keys are. Community attachments are private and opened through short-lived links. No system is perfectly secure, so please use a sign-in method you trust.

## 10. Children

pact is not directed at children under 13, or under 16 where the law of your country sets that age. Please don't create an account or join a Community if you are younger. If you believe a child has given us personal data, contact us and we'll delete it.

## 11. Changes

If this policy changes in a way that matters, we'll update the date at the top and say so in the extension's release notes. Older versions are kept in the project's history.

## 12. Contact

**TODO(owner): replace with a real address — privacy@pact.example is a placeholder.**
