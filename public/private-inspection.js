(() => {
  const players = document.querySelector("#players");
  if (!players) return;

  const languageSelect = document.querySelector("#languageSelect");
  const labels = {
    "zh-TW": { inspected: "查驗", hiddenInspection: "被隱藏" },
    "zh-CN": { inspected: "查验", hiddenInspection: "被隐藏" },
    en: { inspected: "Checked", hiddenInspection: "Hidden" }
  };

  let inspectionTimer = null;
  let inspectionRequestSeq = 0;
  let inspectionAbortController = null;
  let inspectionView = null;
  let inspectionViewContextKey = "";
  let roleLabels = new Map();
  let roleNames = new Set();

  injectInspectionStyle();
  scheduleInspectionRefresh(0);

  const playerObserver = new MutationObserver(() => scheduleInspectionRefresh(30));
  playerObserver.observe(players, { childList: true, subtree: false });
  languageSelect?.addEventListener("change", () => setTimeout(renderInspectionBadges, 0));

  function locale() {
    const value = localStorage.getItem("werewolf-locale") || languageSelect?.value;
    return value === "zh-CN" || value === "en" ? value : "zh-TW";
  }

  function text(key) {
    return labels[locale()]?.[key] || labels["zh-TW"][key] || key;
  }

  function injectInspectionStyle() {
    if (document.querySelector("#privateInspectionBadgeStyle")) return;
    const style = document.createElement("style");
    style.id = "privateInspectionBadgeStyle";
    style.textContent = `
      .pill.private-inspection {
        max-width: 210px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 800;
      }
      .pill.private-inspection::before { content: "◆"; margin-right: 4px; font-size: .72em; }
      .player-row:has(.role-reveal) .pill.private-inspection { display: none !important; }
      @media (max-width: 680px) { .pill.private-inspection { max-width: 160px; } }
    `;
    document.head.append(style);
  }

  function scheduleInspectionRefresh(delay = 40) {
    clearStaleInspectionView();
    clearTimeout(inspectionTimer);
    inspectionTimer = setTimeout(refreshPrivateInspections, delay);
  }

  async function refreshPrivateInspections() {
    const context = inspectionContext();
    if (!context) {
      clearInspectionView();
      return;
    }
    const seq = ++inspectionRequestSeq;
    inspectionAbortController?.abort();
    const controller = new AbortController();
    inspectionAbortController = controller;
    try {
      const [stateResponse] = await Promise.all([
        fetch(`/api/rooms/${context.code}/state?token=${encodeURIComponent(context.token)}`, { cache: "no-store", signal: controller.signal }),
        ensureRoleLabels()
      ]);
      if (!stateResponse.ok) return;
      const next = await stateResponse.json();
      const current = inspectionContext();
      if (seq !== inspectionRequestSeq || controller.signal.aborted || current?.key !== context.key || !next?.me || !Array.isArray(next.players)) return;
      inspectionView = next;
      inspectionViewContextKey = context.key;
      renderInspectionBadges();
    } catch (error) {
      if (error?.name === "AbortError") return;
      // Private decoration is optional and must never block the room UI.
    } finally {
      if (inspectionAbortController === controller) inspectionAbortController = null;
    }
  }

  function clearStaleInspectionView() {
    const context = inspectionContext();
    if (context && (!inspectionViewContextKey || context.key === inspectionViewContextKey)) return;
    clearInspectionView();
  }

  function clearInspectionView() {
    inspectionRequestSeq += 1;
    inspectionAbortController?.abort();
    inspectionAbortController = null;
    inspectionView = null;
    inspectionViewContextKey = "";
    renderInspectionBadges();
  }

  async function ensureRoleLabels() {
    if (roleLabels.size) return;
    try {
      const response = await fetch("/api/roles", { cache: "force-cache" });
      if (!response.ok) return;
      const data = await response.json();
      const roles = Array.isArray(data.roles) ? data.roles : [];
      roleLabels = new Map(roles.map((role) => [String(role.id), String(role.name || role.id)]));
      roleNames = new Set(roles.map((role) => String(role.name || "")).filter(Boolean));
    } catch {
      // Unknown role ids remain readable as a safe fallback.
    }
  }

  function renderInspectionBadges() {
    players.querySelectorAll(".pill.private-inspection").forEach((node) => node.remove());
    const context = inspectionContext();
    if (!context || context.key !== inspectionViewContextKey || !inspectionView?.me || !Array.isArray(inspectionView.players)) return;

    const rowsByName = new Map(
      [...players.querySelectorAll(":scope > .player-row")].map((row) => [playerName(row), row])
    );
    for (const player of inspectionView.players) {
      const values = inspectionValuesFor(player);
      if (!values.length) continue;
      const nameBox = rowsByName.get(String(player.name || ""))?.querySelector(".player-name");
      if (!nameBox) continue;
      for (const value of values) {
        const badge = document.createElement("span");
        badge.className = "pill private-inspection";
        badge.dataset.noTranslate = "";
        badge.title = `${text("inspected")}：${value}`;
        badge.textContent = value;
        nameBox.append(badge);
      }
    }
  }

  function inspectionValuesFor(player) {
    const values = [];
    const faction = inspectionView?.me?.seerResults?.[player.id];
    if (faction) values.push(factionInspectionLabel(faction));

    const results = inspectionView?.me?.roleResults || {};
    const direct = identityResultLabel(results[player.id]);
    const captain = captainIdentityLabel(results[`role:${player.id}`], player.name);
    if (direct) values.push(direct);
    if (captain) values.push(captain);
    return [...new Set(values.filter(Boolean))];
  }

  function factionInspectionLabel(value) {
    if (value === "hidden") return text("hiddenInspection");
    const names = {
      "zh-TW": { village: "好人陣營", werewolf: "狼人陣營", spirit: "怨靈陣營", neutral: "特殊／第三方", blood: "血族陣營" },
      "zh-CN": { village: "好人阵营", werewolf: "狼人阵营", spirit: "怨灵阵营", neutral: "特殊／第三方", blood: "血族阵营" },
      en: { village: "Village", werewolf: "Werewolf", spirit: "Spirit", neutral: "Neutral", blood: "Blood" }
    };
    return names[locale()]?.[value] || String(value);
  }

  function identityResultLabel(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const raw = value.trim();
    if (raw === "被隱藏" || raw === "被隐藏") return text("hiddenInspection");
    if (roleLabels.has(raw)) return roleLabels.get(raw);
    if (roleNames.has(raw)) return raw;
    for (const prefix of ["被放逐者陣營：", "被放逐者阵营：", "上一夜狼刀死者職業：", "上一夜狼刀死者职业："]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
    if (["不是吸血狼", "查到偽狼／叛狼", "查到伪狼／叛狼", "不是偽狼／叛狼", "不是伪狼／叛狼"].includes(raw)) return raw;
    return "";
  }

  function captainIdentityLabel(value, playerNameValue) {
    if (typeof value !== "string" || !value.trim()) return "";
    const raw = value.trim();
    const prefix = [`${playerNameValue}：`, `${playerNameValue}:`].find((item) => raw.startsWith(item));
    const role = prefix ? raw.slice(prefix.length).trim() : "";
    return role ? roleLabels.get(role) || role : "";
  }

  function playerName(row) {
    return String(row.querySelector(".player-name strong")?.textContent || "").trim();
  }

  function roomCode() {
    return String(document.querySelector("#roomCode")?.textContent || location.pathname.match(/^\/([A-Z2-9]{6})\/?$/i)?.[1] || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z2-9]/g, "")
      .slice(0, 6);
  }

  function roomSession(code) {
    if (!code) return null;
    try {
      return JSON.parse(localStorage.getItem(`werewolf-session:${code}`) || "null");
    } catch {
      return null;
    }
  }

  function inspectionContext() {
    const code = roomCode();
    const session = roomSession(code);
    const token = typeof session?.token === "string" ? session.token : "";
    if (!code || !token || !players.children.length) return null;
    return { code, token, key: `${code}\u0000${token}` };
  }
})();
