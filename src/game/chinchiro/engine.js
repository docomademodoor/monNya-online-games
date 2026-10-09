const { evaluateChinchiro, rollDice } = require('./rules');
const STARTING_SOSHIES = 1000;
const ROLE_MULTIPLIERS = {
  pinzoro: 5,
  triple: 3,
  shigoro: 2,
  pair: 1,
  'no-hand': 1,
  hifumi: 2
};

function startRound(roomManager, room) {
  const parentIndex = (room.completedRounds || 0) % room.players.length;
  const parent = room.players[parentIndex];
  room.status = 'playing';
  room.turnIndex = parentIndex;
  room.chinchiroHistory = room.chinchiroHistory || [];
  room.winners = [];
  room.chinchiroPhase = 'betting';
  room.chinchiroParentId = parent.id;
  room.chinchiroBets = {};
  room.chinchiroTurnOrder = [];
  room.players.forEach(player => {
    player.hand = [];
    player.dice = [];
    player.chinchiroHand = null;
    player.rollsUsed = 0;
    player.chinchiroFinished = false;
    player.isWinner = false;
    player.rank = null;
    player.role = null;
    player.soshies ??= STARTING_SOSHIES;
    player.soshiesDelta = 0;
    player.chinchiroBet = null;
  });
  room.actionMessage = '子は賭けるソシーを選択してください';
  return { success: true, room };
}

function placeBet(room, socketId, amount) {
  if (!room || room.gameType !== 'chinchiro' || room.status !== 'playing'
    || room.chinchiroPhase !== 'betting') {
    return { success: false, message: '現在は賭け額を選ぶ時間ではありません' };
  }

  const player = room.players.find(candidate => candidate.id === socketId);
  if (!player || player.id === room.chinchiroParentId) {
    return { success: false, message: '親は賭け額を選べません' };
  }
  if (Object.hasOwn(room.chinchiroBets, socketId)) {
    return { success: false, message: '賭け額はすでに確定しています' };
  }

  const bet = Number(amount);
  if (!Number.isSafeInteger(bet) || bet < 0 || bet > Math.max(0, player.soshies)) {
    return { success: false, message: '残高以内のソシーを指定してください' };
  }
  room.chinchiroBets[socketId] = bet;
  player.chinchiroBet = bet;

  const children = room.players.filter(candidate => candidate.id !== room.chinchiroParentId);
  if (children.every(child => Object.hasOwn(room.chinchiroBets, child.id))) {
    const seatOrder = new Map(room.players.map((candidate, index) => [candidate.id, index]));
    children.sort((left, right) =>
      room.chinchiroBets[left.id] - room.chinchiroBets[right.id]
      || seatOrder.get(left.id) - seatOrder.get(right.id)
    );
    room.chinchiroTurnOrder = [...children.map(child => child.id), room.chinchiroParentId];
    room.chinchiroPhase = 'rolling';
    room.turnIndex = room.players.findIndex(candidate => candidate.id === room.chinchiroTurnOrder[0]);
    room.actionMessage = '賭け額が決まりました。少ない順にサイコロを振ります';
  } else {
    room.actionMessage = '賭け額選択中です…';
  }

  return { success: true, room, completed: room.chinchiroPhase === 'rolling' };
}

function roll(room, socketId) {
  if (!room || room.gameType !== 'chinchiro' || room.status !== 'playing'
    || room.chinchiroPhase !== 'rolling') {
    return { success: false, message: 'チンチロのゲーム中ではありません' };
  }

  const player = room.players[room.turnIndex];
  if (!player || player.id !== socketId) return { success: false, message: 'あなたの番ではありません' };
  if (player.rollsUsed >= 3) return { success: false, message: 'このターンは3回振り終わっています' };

  player.dice = rollDice();
  player.chinchiroHand = evaluateChinchiro(player.dice);
  player.rollsUsed++;
  const handIsDecided = player.chinchiroHand.type !== 'no-hand' || player.rollsUsed >= 3;
  const round = (room.completedRounds || 0) + 1;
  const rollId = (room.chinchiroHistory.at(-1)?.id || 0) + 1;
  room.chinchiroHistory.push({
    id: rollId,
    round,
    playerId: player.id,
    playerName: player.name,
    dice: [...player.dice],
    label: player.chinchiroHand.label,
    rollNumber: player.rollsUsed,
    confirmed: handIsDecided
  });
  if (room.chinchiroHistory.length > 60) room.chinchiroHistory.shift();
  room.actionMessage = `${player.name}：${player.chinchiroHand.label}（${player.rollsUsed}/3回目）`;
  if (handIsDecided) finishTurn(room, player);
  return { success: true, room };
}

function finishTurn(room, player) {
  player.chinchiroFinished = true;
  const currentOrderIndex = room.chinchiroTurnOrder.indexOf(player.id);
  const nextPlayerId = room.chinchiroTurnOrder[currentOrderIndex + 1];
  if (nextPlayerId) {
    const nextIndex = room.players.findIndex(candidate => candidate.id === nextPlayerId);
    room.turnIndex = nextIndex;
    room.actionMessage += `。次は${room.players[nextIndex].name}の番です`;
    return;
  }

  settleRound(room);
}

function settleRound(room) {
  const parent = room.players.find(player => player.id === room.chinchiroParentId);
  if (!parent) return;

  room.players.filter(player => player.id !== parent.id).forEach(child => {
    const bet = room.chinchiroBets[child.id] || 0;
    const childHand = child.chinchiroHand;
    const parentHand = parent.chinchiroHand;
    const childWins = childHand.strength > parentHand.strength;
    const winningHand = childWins ? childHand : parentHand;
    const losingHand = childWins ? parentHand : childHand;
    const multiplier = losingHand.type === 'hifumi'
      ? 2
      : ROLE_MULTIPLIERS[winningHand.type] || 1;
    const transfer = bet * multiplier;

    if (childWins) {
      child.soshies += transfer;
      parent.soshies -= transfer;
      child.soshiesDelta += transfer;
      parent.soshiesDelta -= transfer;
    } else {
      child.soshies -= transfer;
      parent.soshies += transfer;
      child.soshiesDelta -= transfer;
      parent.soshiesDelta += transfer;
    }
  });

  const ranked = [...room.players].sort((left, right) => right.soshies - left.soshies);
  let previousStrength = null;
  let previousRank = 0;
  ranked.forEach((rankedPlayer, index) => {
    if (rankedPlayer.soshies !== previousStrength) {
      previousRank = index + 1;
      previousStrength = rankedPlayer.soshies;
    }
    rankedPlayer.rank = previousRank;
    rankedPlayer.role = rankedPlayer.chinchiroHand.label;
    rankedPlayer.isWinner = previousRank === 1;
  });

  room.winners = ranked.filter(rankedPlayer => rankedPlayer.rank === 1);
  room.status = 'finished';
  room.chinchiroPhase = 'finished';
  room.completedRounds = (room.completedRounds || 0) + 1;
  room.actionMessage = 'ラウンド終了。ソシー残高が更新されました。';
}

function getPublicPlayerState(player) {
  return {
    dice: player.dice || [],
    chinchiroHand: player.chinchiroHand || null,
    rollsUsed: player.rollsUsed || 0,
    chinchiroFinished: !!player.chinchiroFinished,
    chinchiroBet: player.chinchiroBet,
    soshies: player.soshies || 0,
    soshiesDelta: player.soshiesDelta || 0
  };
}

function getPublicState(room) {
  return {
    fieldCards: [],
    isRevolution: false,
    isElevenBack: false,
    isReversed: false,
    lockedSuit: null,
    lockedNumber: null,
    exchangeRequirements: {},
    chinchiroPhase: room.chinchiroPhase || 'betting',
    chinchiroParentId: room.chinchiroParentId || null,
    chinchiroBets: room.chinchiroBets || {},
    chinchiroTurnOrder: room.chinchiroTurnOrder || [],
    chinchiroHistory: room.chinchiroHistory || []
  };
}

module.exports = {
  startRound,
  placeBet,
  roll,
  finishTurn,
  actions: { placeBet, roll },
  getPublicPlayerState,
  getPublicState
};