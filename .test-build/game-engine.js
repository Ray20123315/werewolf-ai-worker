export function roleDeck(playerCount) {
    if (playerCount < 5 || playerCount > 12) {
        throw new Error("玩家人數必須介於 5 到 12 人");
    }
    const table = {
        5: ["werewolf", "seer", "villager", "villager", "villager"],
        6: ["werewolf", "werewolf", "seer", "villager", "villager", "villager"],
        7: ["werewolf", "werewolf", "seer", "villager", "villager", "villager", "villager"],
        8: ["werewolf", "werewolf", "seer", "witch", "villager", "villager", "villager", "villager"],
        9: ["werewolf", "werewolf", "werewolf", "seer", "witch", "villager", "villager", "villager", "villager"],
        10: ["werewolf", "werewolf", "werewolf", "seer", "witch", "villager", "villager", "villager", "villager", "villager"],
        11: ["werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager", "villager", "villager"],
        12: ["werewolf", "werewolf", "werewolf", "werewolf", "seer", "witch", "guard", "villager", "villager", "villager", "villager", "villager"]
    };
    return [...(table[playerCount] ?? [])];
}
export function secureShuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = secureRandomInt(i + 1);
        const current = out[i];
        out[i] = out[j];
        out[j] = current;
    }
    return out;
}
function secureRandomInt(maxExclusive) {
    if (maxExclusive <= 0)
        throw new Error("maxExclusive must be positive");
    const maxUint = 0x1_0000_0000;
    const limit = maxUint - (maxUint % maxExclusive);
    const buffer = new Uint32Array(1);
    do {
        crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % maxExclusive;
}
export function assignRoles(players) {
    const roles = secureShuffle(roleDeck(players.length));
    return players.map((player, index) => ({ ...player, role: roles[index] }));
}
export function teamForRole(role) {
    return role === "werewolf" ? "werewolf" : "village";
}
export function checkWinner(players) {
    const alive = players.filter((p) => p.alive);
    const wolves = alive.filter((p) => p.role === "werewolf").length;
    const village = alive.length - wolves;
    if (wolves === 0)
        return "village";
    if (wolves >= village)
        return "werewolf";
    return undefined;
}
export function pluralityTarget(votes) {
    const counts = new Map();
    for (const target of Object.values(votes)) {
        counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    if (counts.size === 0)
        return undefined;
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ordered.length > 1 && ordered[0][1] === ordered[1][1])
        return undefined;
    return ordered[0][0];
}
export function resolveNight(state) {
    const wolfTarget = pluralityTarget(state.nightActions.wolfVotes);
    const guardTarget = pluralityTarget(state.nightActions.guardTargets);
    const witchAction = firstWitchAction(state.nightActions.witchActions);
    const healed = Boolean(wolfTarget && witchAction?.type === "heal" && state.witchHealAvailable);
    const protectedByGuard = Boolean(wolfTarget && guardTarget === wolfTarget);
    const poisonedTarget = witchAction?.type === "poison" && state.witchPoisonAvailable ? witchAction.targetId : undefined;
    const deaths = new Set();
    if (wolfTarget && !healed && !protectedByGuard)
        deaths.add(wolfTarget);
    if (poisonedTarget)
        deaths.add(poisonedTarget);
    return { wolfTarget, poisonedTarget, deaths: [...deaths], healed, protectedByGuard };
}
function firstWitchAction(actions) {
    return Object.values(actions)[0];
}
export function freshNightActions() {
    return { wolfVotes: {}, seerTargets: {}, guardTargets: {}, witchActions: {} };
}
export function livingPlayers(players) {
    return players.filter((p) => p.alive);
}
export function createDebateOrder(players) {
    return secureShuffle(livingPlayers(players).map((p) => p.id));
}
export function currentDebaterId(order, index) {
    return index >= 0 && index < order.length ? order[index] : undefined;
}
export function isDebateComplete(order, index) {
    return order.length === 0 || index >= order.length;
}
export function canGuardTarget(previousTargetId, targetId) {
    return previousTargetId !== targetId;
}
export function canWitchSelfSave(playerCount, round) {
    return playerCount <= 10 && round === 1;
}
export function areNightActionsComplete(state) {
    const alive = state.players.filter((p) => p.alive);
    for (const player of alive) {
        if (!player.role)
            continue;
        if (player.role === "werewolf" && !state.nightActions.wolfVotes[player.id])
            return false;
        if (player.role === "seer" && !state.nightActions.seerTargets[player.id])
            return false;
        if (player.role === "guard" && !state.nightActions.guardTargets[player.id])
            return false;
        if (player.role === "witch" && !state.nightActions.witchActions[player.id])
            return false;
    }
    return true;
}
export function isAIVotingUnlocked(players, votes) {
    const livingHumans = livingPlayers(players).filter((p) => !p.isAI);
    if (livingHumans.length === 0)
        return true;
    return livingHumans.some((p) => Boolean(votes[p.id]));
}
export function areVotesComplete(state) {
    return livingPlayers(state.players).every((p) => Boolean(state.votes[p.id]));
}
