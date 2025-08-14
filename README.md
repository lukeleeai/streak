Streak — Chrome Extension

Track your streak of NOT visiting distracting sites (e.g., YouTube, Netflix). Streak records calendar days on which you visit any tracked site and visualizes clean days vs visited days, plus a per-site clean streak counter.

Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions/`.
2. Toggle on "Developer mode" (top-right).
3. Click "Load unpacked" and select this folder.
4. Pin the extension. Click the action icon to see your streaks.

Manage Tracked Sites

- Click the popup's "Manage" button or open the Options page from the extensions menu.
- Add items using either a simple substring pattern (like `youtube.com`) or enable "Use regex" for advanced matching.

How It Works

- Listens to web navigation events and matches the active URL against your tracked patterns.
- Stores visit days per site in local storage.
- Displays a 30-day heatmap for each site and a current clean streak (including today when clean).
- The toolbar badge shows `OK` when clean today, `X` if any tracked site has been visited.

Data Export/Import

Use the Options page to export or import your data as JSON.

Reset data (in-app)

- Open the Options page and use:
  - Reset visits only: clears all recorded visit days (keeps tracked sites)
  - Reset everything: removes tracked sites and all visit data

Notes

- Matching: non-regex patterns match if they appear in the hostname or full URL. Regex patterns are applied case-insensitively to the full URL.
- Events: uses `webNavigation.onCommitted`, `onHistoryStateUpdated`, and `onCompleted` to catch both full and SPA navigations.

Reset data (script)

- Requires Node 18+.
- Run:

```bash
node scripts/reset-data.mjs
```

Options:

- `--id <extensionId>`: Explicit extension ID (find in `chrome://extensions`).
- `--path /absolute/path/to/Streak`: Unpacked folder path to auto-detect the ID.
- `--profile <Profile Name>`: Chrome profile directory name (default: `Default`).
- `--chrome-dir <Chrome User Data dir>`: Override Chrome user data root.

Close or reload the extension after running to see changes.

