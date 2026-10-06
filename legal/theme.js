// หน้าข้อกำหนด/นโยบาย: ใช้ธีมเดียวกับที่ผู้ใช้เลือกในแอพ
(function () {
  let theme = 'sepia';
  try { theme = localStorage.getItem('nov_theme') || 'sepia'; } catch (e) {}
  if (!['sepia', 'light', 'dark'].includes(theme)) theme = 'sepia';
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('theme-sepia', 'theme-light', 'theme-dark');
    document.body.classList.add('theme-' + theme);
  });
})();
