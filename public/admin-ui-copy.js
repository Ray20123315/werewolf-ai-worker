(() => {
  const rows = {
    "zh-TW": ["管理後台", "房間", "房間詳情", "錯誤", "Token 只保留在這個瀏覽器 session，不會寫入房間或網址。"],
    "zh-CN": ["管理后台", "房间", "房间详情", "错误", "Token 只保留在这个浏览器 session，不会写入房间或网址。"],
    en: ["ADMIN", "ROOMS", "ROOM", "ERRORS", "The token stays only in this browser session and is never written into a room or URL."]
  };
  const locale = () => {
    const value = localStorage.getItem("werewolf-locale");
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  };
  function apply() {
    const [admin, rooms, room, errors, help] = rows[locale()] || rows["zh-TW"];
    const loginEyebrow = document.querySelector("#adminLogin .eyebrow");
    const loginHelp = document.querySelector("#adminLogin > p");
    if (loginEyebrow) loginEyebrow.textContent = admin;
    if (loginHelp) loginHelp.textContent = help;
    const wideEyebrows = [...document.querySelectorAll("#adminDashboard .admin-wide .eyebrow")];
    if (wideEyebrows[0]) wideEyebrows[0].textContent = rooms;
    if (wideEyebrows[1]) wideEyebrows[1].textContent = errors;
    const sideEyebrow = document.querySelector("#adminDashboard .admin-side .eyebrow");
    if (sideEyebrow) sideEyebrow.textContent = room;
  }
  document.querySelector("#adminLanguage")?.addEventListener("change", () => setTimeout(apply, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
  else apply();
})();
