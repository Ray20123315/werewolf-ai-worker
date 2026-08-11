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
  function set(id, value) {
    const element = document.querySelector(id);
    if (element && element.textContent !== value) element.textContent = value;
  }
  function apply() {
    const [admin, rooms, room, errors, help] = rows[locale()] || rows["zh-TW"];
    set("#adminLoginEyebrow", admin);
    set("#adminToolbarEyebrow", admin);
    set("#adminRoomsEyebrow", rooms);
    set("#adminRoomEyebrow", room);
    set("#adminErrorsEyebrow", errors);
    set("#adminTokenHelp", help);
  }
  document.querySelector("#languageSelect")?.addEventListener("change", () => setTimeout(apply, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
  else apply();
})();
