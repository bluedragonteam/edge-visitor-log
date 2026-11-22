// edge-visitor-log page-view beacon. Add to every page:
//   <script src="https://visits.example.com/visit.js" defer></script>
// Sends the page, the referrer and the title - nothing else, no cookies, no storage.
// Browsers with Do Not Track or Global Privacy Control are not counted.
(function () {
  try {
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    var script = document.currentScript;
    var endpoint = (script && script.getAttribute('data-endpoint')) || new URL('/v', script ? script.src : location.href).href;
    var data = JSON.stringify({ u: location.pathname + location.search, r: document.referrer, t: document.title });
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, data);
  } catch (e) { /* never break the page */ }
})();
