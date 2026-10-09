/**
 * 特殊カード役および効果の適用ハンドラー
 */

const { countEffectiveRank, getSuitComposition, isStraightSequence, isUnbeatablePlay } = require('./rules');
const RANK_VALUES = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14, '2': 15 };

function getUniformRank(cards) {
  if (!cards.length || cards.some(card => card.id === 'JOKER')) return null;
  const ranks = cards.map(card => RANK_VALUES[String(card.num)]);
  return ranks.every(rank => rank !== undefined && rank === ranks[0]) ? ranks[0] : null;
}

function getRankLabel(value) {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' })[value] || String(value);
}

function getStrengthOrderMessage(room) {
  const isReversed = (!!room.isRevolution) !== (!!room.isElevenBack);
  return isReversed ? '強さ逆転、3が最強！' : '通常の強さ、2が最強！';
}

/**
 * カードプレイ時の特殊効果を判定して適用する
 * @param {Object} room - ルームオブジェクト
 * @param {Object} currentPlayer - カードを出したプレイヤー
 * @param {Array} playedCards - 出されたカード配列
 * @param {Object} validation - isValidPlayの判定結果
 * @returns {Object} { clearField: boolean, skipCount: number, actionLogs: string[] }
 */
function applyCardEffects(room, currentPlayer, playedCards, validation, selections = {}) {
  let clearField = false;
  let skipCount = 1;
  const actionLogs = [];

  // 1. スペ3返し (JOKER単体を ♠3 で流す)
  if (validation.isSpe3) {
    clearField = true;
    actionLogs.push(`【スペ3返し！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 2. 革命判定 (同じランクを4枚以上)
  const nonJokers = playedCards.filter(card => card.id !== 'JOKER');
  const isSameRankPlay = nonJokers.length > 0
    && nonJokers.every(card => String(card.num) === String(nonJokers[0].num));
  if (room.rules.revolution && playedCards.length >= 4 && isSameRankPlay) {
    room.isRevolution = !room.isRevolution;
    actionLogs.push(
      room.isRevolution
        ? `【革命！】${getStrengthOrderMessage(room)}`
        : `【革命返し！】${getStrengthOrderMessage(room)}`
    );
  }

  // 階段革命は同ランクの通常革命とは別の条件として一度だけ反転する。
  if (room.rules.staircaseRevolution && room.rules.staircase
    && playedCards.length >= 4 && isStraightSequence(playedCards)) {
    room.isRevolution = !room.isRevolution;
    actionLogs.push(
      room.isRevolution
        ? `【階段革命！】${getStrengthOrderMessage(room)}`
        : `【階段革命解除！】${getStrengthOrderMessage(room)}`
    );
  }

  // 3. 8切り (8を含むカードで場を流す)
  if (room.rules.eightCut && playedCards.some(c => c.num === 8)) {
    clearField = true;
    actionLogs.push(`【8切り！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 通常時の最強手（2の複数枚出し、同一マークのJQK階段）は場を流す。
  if (isUnbeatablePlay(playedCards, room.rules, {
    isRevolution: room.isRevolution,
    isElevenBack: room.isElevenBack,
    lockedSuit: room.lockedSuit,
    lockedNumber: room.lockedNumber
  })) {
    clearField = true;
    actionLogs.push(`【最強手！】${currentPlayer.name} が場を流しました！`);
    return { clearField, skipCount, actionLogs };
  }

  // 4. Jバック (11バック: Jを含む出し方で一時反転)
  if (room.rules.elevenBack && playedCards.some(c => c.num === 'J')) {
    room.isElevenBack = !room.isElevenBack;
    actionLogs.push(
      room.isElevenBack
        ? `【Jバック！】場が流れるまで${getStrengthOrderMessage(room)}`
        : `【Jバック解除！】${getStrengthOrderMessage(room)}`
    );
  }

  // 5. 5飛び
  // 5の枚数が自分以外のアクティブ人数以上になったら、自分のターンに戻る。
  if (room.rules.fiveSkip && playedCards.some(c => c.num === 5)) {
    const players = Array.isArray(room.players) ? room.players : [];
    const otherActivePlayers = players.filter(p => p.id !== currentPlayer.id && p.hand.length > 0).length;
    skipCount = Math.min(playedCards.length + 1, otherActivePlayers + 1);
    const selfTurnNote = skipCount >= otherActivePlayers + 1 ? '。自分の番に戻ります' : '';
    if (skipCount >= otherActivePlayers + 1) {
      clearField = true;
    }
    actionLogs.push(`【5飛び】${playedCards.length}枚で${skipCount - 1}人飛ばし${selfTurnNote}！`);
  }

  // 6. 10捨て (10を出した枚数分だけ、手札から不要なカードを破棄)
  const tenCount = countEffectiveRank(playedCards, 10);
  if (room.rules.tenDiscard && tenCount > 0) {
    if (!Array.isArray(selections.discardedCards)) {
      for (let index = 0; index < tenCount && currentPlayer.hand.length > 0; index++) {
        currentPlayer.hand.shift();
      }
      if (currentPlayer.hand.length === 0) {
        currentPlayer.isWinner = true;
        room.winners.push(currentPlayer);
        currentPlayer.rank = room.winners.length;
      }
    }
  }

  // 7. マーク縛り判定 (同じマークが連続した場合)
  if (room.rules.suitLock && room.fieldCards.length > 0) {
    const prevCard = room.fieldCards[0];
    const currentSuit = playedCards[0].suit;
    if (
      prevCard.suit === currentSuit &&
      playedCards[0].id !== 'JOKER' &&
      prevCard.id !== 'JOKER'
    ) {
      room.lockedSuit = currentSuit;
      actionLogs.push(`【マーク縛り発動！】以降 [${currentSuit}] のみ出せます`);
    }
  }

  // 8. 数字縛り (同じ枚数の同ランク出しが1つずつ続いたら、次のランクを要求)
  if ((room.rules.numberLock || room.rules.completeLock)
    && room.fieldCards.length === playedCards.length) {
    const previousRank = getUniformRank(room.fieldCards);
    const playedRank = getUniformRank(playedCards);
    const startsNumberLock = !room.lockedNumber && room.passCount === 0 &&
      previousRank !== null && playedRank === previousRank + 1;
    const continuesLock = room.lockedNumber && getRankLabel(playedRank) === String(room.lockedNumber);
    const previousSuits = getSuitComposition(room.fieldCards);
    const playedSuits = getSuitComposition(playedCards);
    const sameSuitComposition = previousSuits && playedSuits
      && previousSuits.length === playedSuits.length
      && previousSuits.every((suit, index) => suit === playedSuits[index]);
    const startsLock = startsNumberLock && (!room.rules.completeLock || sameSuitComposition);

    if (startsLock || continuesLock) {
      const nextRank = playedRank < 15 ? getRankLabel(playedRank + 1) : null;
      room.lockedNumber = nextRank;
      room.lockedNumberSuits = room.rules.completeLock && nextRank ? playedSuits : null;
      if (nextRank) {
        actionLogs.push(room.rules.completeLock
          ? `【完縛り！】次は [${nextRank}]、同じマーク構成で出してください`
          : `【数字縛り！】次は [${nextRank}] のカードで出してください`);
      }
    }
  }

  if (actionLogs.length === 0) {
    const cardDisplay = playedCards.map(c => `${c.suit}${c.num}`).join(' ');
    actionLogs.push(`${currentPlayer.name} が ${cardDisplay} を出しました`);
  }

  return { clearField, skipCount, actionLogs };
}

/**
 * 都落ち判定
 */
function checkMiyakoOchi(room, winnerPlayer) {
  if (!room.rules.miyakoOchi || !room.previousRoles || room.winners.length !== 1) {
    return null;
  }

  const prevDaifugo = room.players.find(p => p.previousRole === '大富豪');
  if (prevDaifugo && prevDaifugo.id !== winnerPlayer.id) {
    const usedRanks = new Set(room.players
      .filter(player => player.id !== prevDaifugo.id && Number.isInteger(player.rank))
      .map(player => player.rank));
    let lastAvailableRank = room.players.length;
    while (lastAvailableRank > 1 && usedRanks.has(lastAvailableRank)) {
      lastAvailableRank--;
    }
    prevDaifugo.hand = [];
    prevDaifugo.isWinner = false;
    prevDaifugo.rank = lastAvailableRank;
    prevDaifugo.role = '大貧民';
    return `【都落ち！】大富豪だった ${prevDaifugo.name} は防衛失敗により大貧民に転落しました！`;
  }

  return null;
}

module.exports = {
  applyCardEffects,
  checkMiyakoOchi
};

