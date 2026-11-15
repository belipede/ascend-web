# Ascend web prototype

A one-page test version of Ascend for trying on iPhone Safari. Published with GitHub Pages.
Data is stored only in the browser (localStorage); use Export in the app to back it up.
`sw.js` keeps a copy of the app on the phone so it opens offline; the page is fetched network-first so updates still arrive.
Optional sync: in More, connect a private GitHub repo and a fine-grained token (Contents: read and write, that repo only). The app saves `ascend.json` there; the newer copy wins, each upload is a commit, and the phone keeps its previous copy before any download.
Report bugs and ideas as issues. The native iPhone app lives in a separate private repository.
