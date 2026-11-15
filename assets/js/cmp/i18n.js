// ============================================================
// 語言：中文頁 <html lang="zh-HK">，英文頁 <html lang="en">（喺 /en/ 底下）
// 用法：t('中文', 'English')
// ============================================================
export const EN = document.documentElement.lang.startsWith('en');
export const t = (zh, en) => (EN ? en : zh);
/** 網址前綴：英文頁加 /en */
export const P = EN ? '/en' : '';
export const locale = EN ? 'en-HK' : 'zh-HK';
