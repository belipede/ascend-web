# Ascend web prototype

A one-page test version of Ascend for trying on iPhone Safari. Published with GitHub Pages.
Data is stored only in the browser (localStorage); use Export in the app to back it up.
`sw.js` keeps a copy of the app on the phone so it opens offline; the page is fetched network-first so updates still arrive.
Optional sync: in More, connect a private GitHub repo and a fine-grained token (Contents: read and write, that repo only). The app saves `ascend.json` there; the newer copy wins, each upload is a commit, and the phone keeps its previous copy before any download.
Data safety: if saved data can't be read, the app shows a recovery screen and writes nothing. It keeps automatic backups in localStorage (`ascend-bak:*`: one per day used, last 7, plus one before each restore, delete or sync download, last 5) and shows a warning when a save fails. Sync never uploads an empty phone over GitHub data unless you deleted everything on purpose.
Tests: `node tests/data-safety.js old.html` (old.html = the previous live index.html, e.g. `git show origin/main:index.html`) and `node tests/sync-guard.js`. They need Playwright with Chromium and run Chrome's engine on a simulated iPhone, not Safari.
Report bugs and ideas as issues. The native iPhone app lives in a separate private repository.
