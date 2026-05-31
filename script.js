let currentLang = 'ja';

function toggleLang() {
  currentLang = currentLang === 'ja' ? 'en' : 'ja';
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-ja][data-en]').forEach((el) => {
    el.textContent = el.dataset[currentLang];
  });
  document.body.classList.remove('menu-open');
}
