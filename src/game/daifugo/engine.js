const { createDeck } = require('../../utils/deck');
const { isValidPlay, checkForbiddenFinish, countEffectiveRank } = require('./rules');
const { applyCardEffects, checkMiyakoOchi } = require('./cardEffects');

const ROLE_POINTS = {
  '大富豪': 3,
  '富豪': 2,
  '平民': 0,
  '貧民': -1,
  '大貧民': -2
};
const CLEARED_FIELD_DISPLAY_MS = 1800;

function requiresDiamondThreeForOpeningPlay(room, player) {
  return !!player
    && room.rules.dia3Start !== false
    && !room.previousRoles
    && player.id === room.firstTurnExemptPlayerId
    && player.hand.some(card => card.id === '♦3');
}

function startRound(roomManager, room) {
  room.fieldCards = [];
  room.playedCardIds = [];
  room.clearedFieldCards = [];
  room.clearedFieldAt = null;
  room.passCount = 0;
  room.lastPlayedIndex = 0;
  room.isRevolution = false;
  room.isElevenBack = false;
  room.lockedSuit = null;
  room.lockedNumber = null;
  room.lockedNumberSuits = null;
  room.winners = [];
  room.exchangeRequirements = {};
  room.exchangeSelections = {};
  room.turnDeadlineAt = null;
  room.firstTurnExemptPlayerId = null;
  room.pendingSideSelection = null;

  if (room.players.some(player => player.isLateJoiner)) {
    room.previousRoles = null;
    room.players.forEach(player => {
      player.isLateJoiner = false;
      player.role = null;
      player.previousRole = null;
    });
  }

  const deck = createDeck(room.rules.includeJoker);
  room.players.forEach(player => {
    player.hand = [];
    player.isWinner = false;
    player.rank = null;
  });
  deck.forEach((card, index) => room.players[index % room.players.length].hand.push(card));
  room.players.forEach(player => player.hand.sort((left, right) => left.strength - right.strength));

  for (let index = room.players.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [room.players[index], room.players[swapIndex]] = [room.players[swapIndex], room.players[index]];
  }
  room.turnIndex = Math.floor(Math.random() * room.players.length);
  selectStartingPlayer(room);

  const exchangePlan = buildExchangePlan(room);
  if (exchangePlan.length > 0) {
    room.status = 'waiting-exchange';
    room.exchangeRequirements = exchangePlan.reduce((requirements, pair) => {
      requirements[pair.fromId] = pair.count;
      return requirements;
    }, {});
    room.actionMessage = 'カード交換のカードを選んでください';
    return { success: true, room };
  }

  room.status = 'playing';
  room.actionMessage = 'ゲーム開始！カードを配りました。';
  return { success: true, room };
}

function getPublicPlayerState(player) {
  return { cardCount: player.hand.length };
}

function getPublicState(room) {
  const currentPlayer = room.players[room.turnIndex];
  return {
    fieldCards: room.fieldCards,
    clearedFieldCards: room.clearedFieldAt && Date.now() - room.clearedFieldAt <= CLEARED_FIELD_DISPLAY_MS
      ? room.clearedFieldCards || []
      : [],
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    isReversed: (!!room.isRevolution) !== (!!room.isElevenBack),
    lockedSuit: room.lockedSuit,
    lockedNumber: room.lockedNumber,
    lockedNumberSuits: room.lockedNumberSuits || null,
    exchangeRequirements: room.exchangeRequirements || {},
    mustPlayDiamondThree: requiresDiamondThreeForOpeningPlay(room, currentPlayer)
  };
}

function selectStartingPlayer(room) {
  if (!room.previousRoles && room.rules.dia3Start) {
    const dia3HolderIndex = room.players.findIndex(player =>
      player.hand.some(card => card.suit === '♦' && card.num === 3)
    );
    if (dia3HolderIndex !== -1) {
      room.turnIndex = dia3HolderIndex;
      room.actionMessage = `【♢3スタート】♦3を持っている ${room.players[dia3HolderIndex].name} からターン開始です！`;
    }
  } else if (room.previousRoles) {
    const lowestRole = room.players.length <= 3 ? '貧民' : '大貧民';
    const lowRankIndex = room.players.findIndex(player => player.role === lowestRole);
    if (lowRankIndex !== -1) {
      room.turnIndex = lowRankIndex;
      room.actionMessage = `${room.players[lowRankIndex].role}の ${room.players[lowRankIndex].name} からスタートです！`;
    }
  }

  room.firstTurnExemptPlayerId = room.players[room.turnIndex]?.id || null;
}

function buildExchangePlan(room) {
  const daifugo = room.players.find(player => player.role === '大富豪');
  const fugo = room.players.find(player => player.role === '富豪');
  const hinmin = room.players.find(player => player.role === '貧民');
  const daihinmin = room.players.find(player => player.role === '大貧民');
  const pairs = [];

  if (daifugo && daihinmin) pairs.push({ fromId: daifugo.id, toId: daihinmin.id, count: 2 });
  if (fugo && hinmin) pairs.push({ fromId: fugo.id, toId: hinmin.id, count: 1 });
  return pairs;
}

function handleCardExchange(room, selections = {}) {
  for (const pair of buildExchangePlan(room)) {
    const from = room.players.find(player => player.id === pair.fromId);
    const to = room.players.find(player => player.id === pair.toId);
    const chosen = Array.isArray(selections[pair.fromId]) ? selections[pair.fromId] : [];
    if (!from || !to || chosen.length !== pair.count) continue;

    const chosenIds = chosen.map(card => typeof card === 'string' ? card : card?.id);
    if (chosenIds.some(id => typeof id !== 'string') || new Set(chosenIds).size !== chosen.length) continue;
    const canonicalCards = chosenIds.map(id => from.hand.find(card => card.id === id));
    if (canonicalCards.some(card => !card)) continue;

    const chosenIdSet = new Set(chosenIds);
    from.hand = from.hand.filter(card => !chosenIdSet.has(card.id));
    to.hand.push(...canonicalCards);
    to.hand.sort((left, right) => left.strength - right.strength);
  }

  room.players.forEach(player => player.hand.sort((left, right) => left.strength - right.strength));
}

function getNextTurnIndex(room, currentIndex, skipCount = 1) {
  let nextIndex = currentIndex;
  let counted = 0;
  for (let offset = 1; offset <= room.players.length * 2; offset++) {
    const candidateIndex = (currentIndex + offset) % room.players.length;
    if (room.players[candidateIndex].hand.length > 0) {
      counted++;
      nextIndex = candidateIndex;
      if (counted >= skipCount) return nextIndex;
    }
  }
  return nextIndex;
}

function submitExchangeCards(roomManager, socketId, { roomId, cards }) {
  const room = roomManager.rooms[roomId];
  if (!room || room.gameType !== 'daifugo') return { success: false, message: 'ルームが存在しません' };
  if (room.status !== 'waiting-exchange') return { success: false, message: 'カード交換の準備ができていません' };

  const requiredCount = room.exchangeRequirements?.[socketId];
  if (!requiredCount) return { success: false, message: 'あなたはカード交換の対象ではありません' };

  const selected = Array.isArray(cards) ? cards : [cards];
  if (selected.length !== requiredCount) {
    return { success: false, message: `${requiredCount}枚を選んで交換してください` };
  }

  const player = room.players.find(candidate => candidate.id === socketId);
  if (!player) return { success: false, message: 'プレイヤーが見つかりません' };

  const selectedIds = selected.map(card => typeof card === 'string' ? card : card?.id);
  if (selectedIds.some(id => typeof id !== 'string') || new Set(selectedIds).size !== selected.length) {
    return { success: false, message: '交換するカードを重複なく選んでください' };
  }
  const canonicalCards = selectedIds.map(id => player.hand.find(card => card.id === id));
  if (canonicalCards.some(card => !card)) {
    return { success: false, message: '選んだカードはあなたの手札にありません' };
  }

  room.exchangeSelections = room.exchangeSelections || {};
  room.exchangeSelections[socketId] = canonicalCards;
  const allSubmitted = Object.keys(room.exchangeRequirements || {}).every(playerId =>
    room.exchangeSelections[playerId]
      && room.exchangeSelections[playerId].length === room.exchangeRequirements[playerId]
  );
  if (!allSubmitted) {
    room.actionMessage = 'カード選択中です…';
    return { success: true, room, completed: false };
  }

  handleCardExchange(room, room.exchangeSelections);
  room.status = 'playing';
  room.exchangeRequirements = {};
  room.exchangeSelections = {};
  room.actionMessage = 'カード交換が完了しました。ゲームを開始します。';
  return { success: true, room, completed: true };
}

function getSideSelectionRequirements(room, player, playedCards) {
  const playedIds = new Set(playedCards.map(card => card.id));
  const remainingCount = player.hand.filter(card => !playedIds.has(card.id)).length;
  const sevenCount = room.rules.sevenPass === false ? 0 : countEffectiveRank(playedCards, 7);
  const tenCount = room.rules.tenDiscard === false ? 0 : countEffectiveRank(playedCards, 10);
  const pass = Math.min(sevenCount, remainingCount);
  const discard = Math.min(tenCount, remainingCount - pass);
  return { pass, discard };
}

function playCards(roomManager, socketId, { roomId, cards, discardCards = [], passedCards = [] }) {
  const room = roomManager.rooms[roomId];
  if (!room || room.gameType !== 'daifugo' || room.status !== 'playing') {
    return { success: false, message: 'ゲーム中ではありません' };
  }

  const currentPlayer = room.players[room.turnIndex];
  if (!currentPlayer || currentPlayer.id !== socketId) {
    return { success: false, message: 'あなたのターンではありません！' };
  }
  const requestedCards = Array.isArray(cards) ? cards : [cards];
  if (requestedCards.length === 0) return { success: false, message: '出すカードを選択してください' };

  const playedIds = requestedCards.map(card => typeof card === 'string' ? card : card?.id);
  if (playedIds.some(id => typeof id !== 'string') || new Set(playedIds).size !== requestedCards.length) {
    return { success: false, message: '出すカードを重複なく選んでください' };
  }
  const cardsById = new Map(currentPlayer.hand.map(card => [card.id, card]));
  const playedCards = playedIds.map(id => cardsById.get(id));
  if (playedCards.some(card => !card)) {
    return { success: false, message: '指定されたカードを所持していません' };
  }

  if (room.pendingSideSelection?.playerId === currentPlayer.id) {
    const pendingIds = [...room.pendingSideSelection.cardIds].sort();
    const submittedIds = [...playedIds].sort();
    if (pendingIds.length !== submittedIds.length || pendingIds.some((id, index) => id !== submittedIds[index])) {
      return { success: false, message: '追加カード選択中は、最初に選んだカードを出してください。' };
    }
  }

  const playedIdSet = new Set(playedIds);
  const hasSevenPass = room.rules.sevenPass !== false && countEffectiveRank(playedCards, 7) > 0;
  const hasTenDiscard = room.rules.tenDiscard !== false && countEffectiveRank(playedCards, 10) > 0;
  const { pass: passRequired, discard: discardRequired } = getSideSelectionRequirements(room, currentPlayer, playedCards);
  const hasDiamondThree = currentPlayer.hand.some(card => card.id === '♦3');
  if (requiresDiamondThreeForOpeningPlay(room, currentPlayer)
    && hasDiamondThree && !playedCards.some(card => card.id === '♦3')) {
    return { success: false, message: '♦3を持っている場合は、♦3を含むカードを出してください。' };
  }

  const discardIds = Array.isArray(discardCards) ? discardCards : [];
  const passIds = Array.isArray(passedCards) ? passedCards : [];
  if (discardIds.some(id => typeof id !== 'string') || new Set(discardIds).size !== discardIds.length) {
    return { success: false, message: '捨てるカードを重複なく選んでください。' };
  }
  if (passIds.some(id => typeof id !== 'string') || new Set(passIds).size !== passIds.length) {
    return { success: false, message: '渡すカードを重複なく選んでください。' };
  }
  if (!hasTenDiscard && discardIds.length > 0) {
    return { success: false, message: '10捨ての効果がないカードは捨てられません。' };
  }
  if (!hasSevenPass && passIds.length > 0) {
    return { success: false, message: '7渡しの効果がないカードは渡せません。' };
  }

  if (hasTenDiscard) {
    if (discardIds.length !== discardRequired) {
      return { success: false, message: `10捨てでは、捨てるカードを${discardRequired}枚選んでください。` };
    }
    const validDiscard = discardIds.every(id =>
      currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
    );
    if (!validDiscard) return { success: false, message: '捨てるカードは自分の手札から選んでください。' };
  }

  if (hasSevenPass) {
    if (passRequired !== passIds.length) {
      return { success: false, message: `7渡しでは、渡すカードを${passRequired}枚選んでください。` };
    }
    const validPass = passIds.every(id =>
      currentPlayer.hand.some(card => card.id === id) && !playedCards.some(card => card.id === id)
    );
    if (!validPass) return { success: false, message: '7渡しのカードは手札から選んでください。' };
  }
  if (passIds.some(id => discardIds.includes(id))) {
    return { success: false, message: '渡すカードと捨てるカードは別々に選んでください。' };
  }

  const validation = isValidPlay(playedCards, room.fieldCards, room.rules, {
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    lockedSuit: room.lockedSuit,
    lockedNumber: room.lockedNumber,
    lockedNumberSuits: room.lockedNumberSuits
  });
  if (!validation.valid) return { success: false, message: validation.message };

  room.firstTurnExemptPlayerId = null;
  room.pendingSideSelection = null;
  const finishCheck = checkForbiddenFinish(playedCards, currentPlayer.hand.length, room.rules, {
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    isSpe3: validation.isSpe3
  });
  if (finishCheck.isForbidden) {
    currentPlayer.hand = [];
    currentPlayer.isWinner = false;
    currentPlayer.rank = getLastAvailableRank(room);
    currentPlayer.role = '大貧民';
    room.fieldCards = [];
    room.isElevenBack = false;
    room.lockedSuit = null;
    room.lockedNumber = null;
    room.lockedNumberSuits = null;
    room.passCount = 0;
    room.actionMessage = `【禁止上がり！】${currentPlayer.name} は ${finishCheck.reason} 反則負けで最下位になりました！`;
    room.turnIndex = getNextTurnIndex(room, room.turnIndex);
    checkGameCompletion(room);
    return { success: true, room, updatedHand: [] };
  }

  const discardSet = new Set(discardIds);
  const passSet = new Set(passIds);
  const passedCardsList = currentPlayer.hand.filter(card => passSet.has(card.id));
  const discardedCardsList = currentPlayer.hand.filter(card => discardSet.has(card.id));
  const playedCardIds = new Set(room.playedCardIds || []);
  playedCards.forEach(card => playedCardIds.add(card.id));
  discardedCardsList.forEach(card => playedCardIds.add(card.id));
  room.playedCardIds = [...playedCardIds];
  currentPlayer.hand = currentPlayer.hand.filter(card => !playedIdSet.has(card.id));
  currentPlayer.hand = currentPlayer.hand.filter(card => !discardSet.has(card.id));
  currentPlayer.hand = currentPlayer.hand.filter(card => !passSet.has(card.id));

  if (currentPlayer.hand.length === 0) {
    currentPlayer.isWinner = true;
    currentPlayer.rank = getNextAvailableRank(room);
    if (!room.winners.some(winner => winner.id === currentPlayer.id)) room.winners.push(currentPlayer);
    const miyakoMessage = checkMiyakoOchi(room, currentPlayer);
    if (miyakoMessage) room.actionMessage = miyakoMessage;
  }

  const effects = applyCardEffects(room, currentPlayer, playedCards, validation, {
    discardedCards: discardedCardsList
  });
  if (room.rules.sevenPass !== false && countEffectiveRank(playedCards, 7) > 0 && passedCardsList.length > 0) {
    const nextIndex = getNextTurnIndex(room, room.turnIndex);
    const nextPlayer = room.players[nextIndex];
    nextPlayer.hand.push(...passedCardsList);
    nextPlayer.hand.sort((left, right) => left.strength - right.strength);
  }

  if (effects.clearField) {
    room.clearedFieldCards = [...playedCards];
    room.clearedFieldAt = Date.now();
    room.fieldCards = [];
    room.passCount = 0;
    room.isElevenBack = false;
    room.lockedSuit = null;
    room.lockedNumber = null;
    room.lockedNumberSuits = null;
    if (currentPlayer.hand.length === 0) room.turnIndex = getNextTurnIndex(room, room.turnIndex);
  } else {
    room.clearedFieldCards = [];
    room.clearedFieldAt = null;
    room.fieldCards = playedCards;
    room.lastPlayedIndex = room.turnIndex;
    room.passCount = 0;
    room.turnIndex = getNextTurnIndex(room, room.turnIndex, effects.skipCount);
  }

  room.actionMessage = effects.actionLogs.join(' ');
  checkGameCompletion(room);
  return { success: true, room, updatedHand: currentPlayer.hand };
}

function passTurn(roomManager, socketId, roomId) {
  const room = roomManager.rooms[roomId];
  if (!room || room.gameType !== 'daifugo' || room.status !== 'playing') {
    return { success: false, message: 'ゲーム中ではありません' };
  }

  const currentPlayer = room.players[room.turnIndex];
  if (!currentPlayer || currentPlayer.id !== socketId) {
    return { success: false, message: 'あなたのターンではありません！' };
  }
  if (room.pendingSideSelection?.playerId === currentPlayer.id) {
    return { success: false, message: 'カードの捨て渡し選択を完了してください。' };
  }

  room.firstTurnExemptPlayerId = null;
  if (room.fieldCards.length === 0) {
    room.clearedFieldCards = [];
    room.clearedFieldAt = null;
    room.passCount = 0;
    room.turnIndex = getNextTurnIndex(room, room.turnIndex);
    room.actionMessage = `${currentPlayer.name} がパスしました。`;
    return { success: true, room };
  }

  const activePlayers = room.players.filter(player => player.hand.length > 0);
  room.clearedFieldCards = [];
  room.clearedFieldAt = null;
  room.passCount++;
  if (room.passCount >= activePlayers.length - 1) {
    room.clearedFieldCards = [...room.fieldCards];
    room.clearedFieldAt = Date.now();
    room.fieldCards = [];
    room.isElevenBack = false;
    room.lockedSuit = null;
    room.lockedNumber = null;
    room.lockedNumberSuits = null;
    room.passCount = 0;
    const lastPlayer = room.players[room.lastPlayedIndex];
    room.turnIndex = lastPlayer?.hand.length > 0
      ? room.lastPlayedIndex
      : getNextTurnIndex(room, room.lastPlayedIndex);
    room.actionMessage = '全員がパスしたため、場が流れました。';
  } else {
    room.turnIndex = getNextTurnIndex(room, room.turnIndex);
    room.actionMessage = `${currentPlayer.name} がパスしました。`;
  }
  return { success: true, room };
}

function getNextAvailableRank(room) {
  const usedRanks = new Set(room.players.map(player => player.rank).filter(Number.isInteger));
  for (let rank = 1; rank <= room.players.length; rank++) {
    if (!usedRanks.has(rank)) return rank;
  }
  return room.players.length;
}

function getLastAvailableRank(room) {
  const usedRanks = new Set(room.players.map(player => player.rank).filter(Number.isInteger));
  for (let rank = room.players.length; rank >= 1; rank--) {
    if (!usedRanks.has(rank)) return rank;
  }
  return room.players.length;
}

function checkGameCompletion(room) {
  if (room.status === 'finished') return;
  const activePlayers = room.players.filter(player => player.hand.length > 0);
  if (activePlayers.length > 1) return;

  room.status = 'finished';
  if (activePlayers.length === 1) {
    const lastPlayer = activePlayers[0];
    if (!Number.isInteger(lastPlayer.rank)) lastPlayer.rank = getNextAvailableRank(room);
    if (!room.winners.some(winner => winner.id === lastPlayer.id)) room.winners.push(lastPlayer);
  }
  assignRoles(room);
  room.completedRounds = (room.completedRounds || 0) + 1;
  room.players.forEach(player => {
    if (player.isLateJoiner) return;
    player.totalPoints = (player.totalPoints || 0) + (ROLE_POINTS[player.role] ?? 0);
  });
  room.actionMessage = 'ゲーム終了！順位と階級が決定しました！';
}

function assignRoles(room) {
  const sorted = room.players
    .filter(player => !player.isLateJoiner)
    .sort((left, right) => (left.rank || 99) - (right.rank || 99));
  const count = sorted.length;
  const roleTables = {
    2: ['富豪', '貧民'],
    3: ['富豪', '平民', '貧民'],
    4: ['大富豪', '富豪', '貧民', '大貧民'],
    5: ['大富豪', '富豪', '平民', '貧民', '大貧民'],
    6: ['大富豪', '富豪', '平民', '平民', '貧民', '大貧民']
  };

  sorted.forEach(player => {
    const roleTable = roleTables[count];
    if (roleTable) player.role = roleTable[player.rank - 1] || '平民';
    else if (player.rank === 1) player.role = '大富豪';
    else if (player.rank === count) player.role = '大貧民';
    else if (player.rank === 2) player.role = '富豪';
    else if (player.rank === count - 1) player.role = '貧民';
    else player.role = '平民';
  });

  room.previousRoles = {};
  sorted.forEach(player => {
    player.previousRole = player.role;
    room.previousRoles[player.id] = player.role;
  });
  room.players.filter(player => player.isLateJoiner).forEach(player => {
    player.role = '平民';
    player.rank = null;
  });
}

module.exports = {
  startRound,
  selectStartingPlayer,
  buildExchangePlan,
  handleCardExchange,
  getNextTurnIndex,
  submitExchangeCards,
  getSideSelectionRequirements,
  playCards,
  passTurn,
  getNextAvailableRank,
  getLastAvailableRank,
  checkGameCompletion,
  assignRoles,
  getPublicPlayerState,
  getPublicState
};