// Current edition year, taken from the URL: /2026/... -> "2026"
const AGEWEC_YEAR = (location.pathname.match(/^\/(\d{4})(?=\/|$)/) || [])[1] || '2026';

// Year-scope an absolute app path, e.g. ay('/submit/') -> '/2026/submit/'
function ay(path) {
  if (!path || path[0] !== '/') return path;
  if (/^\/(styles\.css|script\.js|assets\/|favicon)/.test(path)) return path; // shared root assets
  if (/^\/\d{4}(\/|$)/.test(path)) return path;                                // already year-scoped
  return '/' + AGEWEC_YEAR + path;
}

// Rewrite static internal links so navigation stays within the current year.
function scopeLinks() {
  const apps = ['/submit/', '/judge/', '/admin/', '/rules/', '/privacy/', '/ai-guidelines/'];
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const h = a.getAttribute('href');
    if (/^\/(styles\.css|script\.js|assets\/|favicon)/.test(h)) return;
    if (/^\/\d{4}(\/|$)/.test(h)) return;
    if (h === '/') { a.setAttribute('href', '/' + AGEWEC_YEAR + '/'); return; }
    if (h.startsWith('/#')) { a.setAttribute('href', '/' + AGEWEC_YEAR + '/' + h.slice(1)); return; }
    if (apps.some((p) => h === p || h.startsWith(p))) a.setAttribute('href', '/' + AGEWEC_YEAR + h);
  });
}

let currentLang = 'ja';
function toggleLang() {
  currentLang = currentLang === 'ja' ? 'en' : 'ja';
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-ja][data-en]').forEach((el) => {
    el.textContent = el.dataset[currentLang];
  });
  document.body.classList.remove('menu-open');
}

scopeLinks();
