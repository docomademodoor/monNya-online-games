import { describe, it, expect } from 'vitest';
import { isCardSelectable, isValidCombination, isValidPlay } from '../public/js/rules.js';
import RoomManager from '../src/game/roomManager.js';
import daifugoDefinition from '../src/game/daifugo/definition.js';

describe('カードルール判定', () => {
  it('数字縛りと完縛りは相互排他で両方オフも許可する', () => {
    expect(daifugoDefinition.createRules({ numberLock: true, completeLock: true }))
      .toMatchObject({ numberLock: false, completeLock: true });
    expect(daifugoDefinition.createRules({ numberLock: false, completeLock: false }))
      .toMatchObject({ numberLock: false, completeLock: false });
  });

  it('同じ数字のペアは空場で出せる', () => {
    const cards = [
      { id: 'h1', suit: '♥', num: 10, strength: 10 },
      { id: 'h2', suit: '♦', num: 10, strength: 10 }
    ];

    const result = isValidPlay(cards, [], {}, {});
    expect(result.valid).toBe(true);
  });

  it('空場の階段は数字の異なるカードを段階的に選択できる', () => {
    const hand = [
      { id: 'spade-3', suit: '♠', num: '3', strength: 1 },
      { id: 'spade-4', suit: '♠', num: '4', strength: 2 },
      { id: 'spade-5', suit: '♠', num: '5', strength: 3 },
      { id: 'heart-4', suit: '♥', num: '4', strength: 2 }
    ];

    expect(isCardSelectable(hand[1], hand, [hand[0]], [], { staircase: true })).toBe(true);
    expect(isCardSelectable(hand[2], hand, hand.slice(0, 2), [], { staircase: true })).toBe(true);
    expect(isCardSelectable(hand[3], hand, [hand[0]], [], { staircase: true })).toBe(false);
  });

  it('♦3必須は初回の♦3スタート手番だけに適用される', () => {
    const roomId = 'dia3-stair-test';
    RoomManager.rooms = {};
    RoomManager.createRoom({ id: 'host' }, {
      roomId,
      playerName: 'A',
      playerId: 'p1',
      rules: { dia3Start: true, staircase: true }
    });
    RoomManager.joinRoom({ id: 'guest' }, {
      roomId,
      playerName: 'B',
      playerId: 'p2'
    });

    const room = RoomManager.rooms[roomId];
    const player = room.players[0];
    room.status = 'playing';
    room.turnIndex = 0;
    room.previousRoles = null;
    room.fieldCards = [];
    room.firstTurnExemptPlayerId = player.id;
    Object.assign(room.rules, {
      eightCut: false,
      fiveSkip: false,
      tenDiscard: false,
      sevenPass: false
    });
    player.hand = [
      { id: '♦3', suit: '♦', num: '3', strength: 1 },
      { id: '♠9', suit: '♠', num: '9', strength: 7 },
      { id: '♠10', suit: '♠', num: '10', strength: 8 },
      { id: '♠J', suit: '♠', num: 'J', strength: 9 }
    ];
    const staircase = player.hand.slice(1);

    expect(RoomManager.getPublicState(room).mustPlayDiamondThree).toBe(true);
    const openingPlay = RoomManager.playCards(player.id, { roomId, cards: staircase });
    expect(openingPlay.success).toBe(false);
    expect(openingPlay.message).toContain('♦3');
    expect(room.playedCardIds).toBeUndefined();

    room.firstTurnExemptPlayerId = null;
    expect(RoomManager.getPublicState(room).mustPlayDiamondThree).toBe(false);
    expect(RoomManager.playCards(player.id, { roomId, cards: staircase }).success).toBe(true);
    expect(room.playedCardIds).toEqual(staircase.map(card => card.id));
  });

  it('空場の8切りでも場を流したカードを公開状態に残す', () => {
    const roomId = 'cleared-field-display-test';
    RoomManager.rooms = {};
    RoomManager.createRoom({ id: 'sA' }, { roomId, playerName: 'A', playerId: 'p1', rules: {} });
    RoomManager.joinRoom({ id: 'sB' }, { roomId, playerName: 'B', playerId: 'p2' });

    const room = RoomManager.rooms[roomId];
    const player = room.players[0];
    const eight = { id: 'spade-8', suit: '♠', num: 8, strength: 6 };
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.rules.eightCut = true;
    room.rules.forbiddenFinish = false;
    room.rules.spe3 = false;
    room.rules.fiveSkip = false;
    room.rules.tenDiscard = false;
    room.rules.sevenPass = false;
    player.hand = [eight, { id: 'heart-3', suit: '♥', num: 3, strength: 1 }];
    room.players[1].hand = [{ id: 'club-9', suit: '♣', num: 9, strength: 7 }];

    const result = RoomManager.playCards(player.id, { roomId, cards: [eight.id] });

    expect(result.success).toBe(true);
    expect(room.fieldCards).toEqual([]);
    expect(RoomManager.getPublicState(room).clearedFieldCards).toEqual([eight]);
  });

  it('ジョーカーを階段の穴埋めに使える', () => {
    const cards = ['3', '4', '5', 'JOKER', '7', '8', '9', '10'].map((num, index) => ({
      id: num === 'JOKER' ? 'JOKER' : `s${index}`,
      suit: num === 'JOKER' ? '' : '♠',
      num,
      strength: num === 'JOKER' ? 14 : Number(num)
    }));

    expect(isValidCombination(cards, { staircase: true }).valid).toBe(true);
  });

  it('階段には同枚数のtripletやquadで返せない', () => {
    const staircase3 = [3, 4, 5].map((num, index) => ({
      id: `stairs3-${index}`,
      suit: '♠',
      num,
      strength: num - 2
    }));
    const triplet = ['♥', '♦', '♣'].map((suit, index) => ({
      id: `triplet-${index}`,
      suit,
      num: 8,
      strength: 6
    }));
    const staircase4 = [3, 4, 5, 6].map((num, index) => ({
      id: `stairs4-${index}`,
      suit: '♥',
      num,
      strength: num - 2
    }));
    const quad = ['♠', '♥', '♦', '♣'].map(suit => ({
      id: `quad-${suit}`,
      suit,
      num: 9,
      strength: 7
    }));
    const strongerStaircase = [4, 5, 6].map((num, index) => ({
      id: `higher-stairs-${index}`,
      suit: '♦',
      num,
      strength: num - 2
    }));

    expect(isValidPlay(triplet, staircase3, { staircase: true }).valid).toBe(false);
    expect(isValidPlay(quad, staircase4, { staircase: true }).valid).toBe(false);
    expect(isValidPlay(strongerStaircase, staircase3, { staircase: true }).valid).toBe(true);
  });

  it('マーク縛り中は違うマークを出せない', () => {
    const field = [
      { id: 's2', suit: '♠', num: 2, strength: 2 },
      { id: 's3', suit: '♠', num: 3, strength: 3 }
    ];

    const valid = isValidPlay([
      { id: 's1', suit: '♠', num: 5, strength: 5 },
      { id: 's2b', suit: '♠', num: 5, strength: 5 }
    ], field, { suitLock: true }, { lockedSuit: '♠' });
    expect(valid.valid).toBe(true);

    const invalid = isValidPlay([
      { id: 'h1', suit: '♥', num: 5, strength: 5 },
      { id: 'h2', suit: '♥', num: 5, strength: 5 }
    ], field, { suitLock: true }, { lockedSuit: '♠' });

    expect(invalid.valid).toBe(false);
    expect(invalid.message).toContain('マーク縛り');
  });

  it('数字縛り中は指定された数字だけで応じられる', () => {
    const field = [
      { id: 'd2', suit: '♦', num: 2, strength: 2 },
      { id: 'd3', suit: '♦', num: 3, strength: 3 }
    ];

    const valid = isValidPlay([
      { id: 'c1', suit: '♣', num: 4, strength: 4 },
      { id: 'c2', suit: '♣', num: 4, strength: 4 }
    ], field, { numberLock: true }, { lockedNumber: 4 });
    expect(valid.valid).toBe(true);

    const invalid = isValidPlay([
      { id: 's1', suit: '♠', num: 7, strength: 7 },
      { id: 's2', suit: '♠', num: 7, strength: 7 }
    ], field, { numberLock: true }, { lockedNumber: 5 });

    expect(invalid.valid).toBe(false);
    expect(invalid.message).toContain('数字縛り');
  });

  it('数字縛り中の選択補助は指定数字のペアだけ選べる', () => {
    const hand = [
      { id: 'c8', suit: '♣', num: 8, strength: 6 },
      { id: 'd8', suit: '♦', num: 8, strength: 6 },
      { id: 'c9', suit: '♣', num: 9, strength: 7 },
      { id: 'd9', suit: '♦', num: 9, strength: 7 }
    ];
    const field = [
      { id: 's7', suit: '♠', num: 7, strength: 5 },
      { id: 'h7', suit: '♥', num: 7, strength: 5 }
    ];
    const state = { lockedNumber: 8 };

    expect(isCardSelectable(hand[0], hand, [], field, { numberLock: true }, state)).toBe(true);
    expect(isCardSelectable(hand[2], hand, [], field, { numberLock: true }, state)).toBe(false);
    expect(isCardSelectable(hand[1], hand, [hand[0]], field, { numberLock: true }, state)).toBe(true);
    expect(isCardSelectable(hand[3], hand, [hand[0]], field, { numberLock: true }, state)).toBe(false);
  });

  it('完縛り中は同じ数字でも異なるスート構成を選べない', () => {
    const field = [
      { id: 'spade-6', suit: '♠', num: 6, strength: 4 },
      { id: 'heart-6', suit: '♥', num: 6, strength: 4 }
    ];
    const state = { lockedNumber: '7', lockedNumberSuits: ['♠', '♥'] };
    const rules = { completeLock: true };
    const matching = [
      { id: 'spade-7', suit: '♠', num: 7, strength: 5 },
      { id: 'heart-7', suit: '♥', num: 7, strength: 5 }
    ];
    const mismatched = [
      { id: 'club-7', suit: '♣', num: 7, strength: 5 },
      { id: 'diamond-7', suit: '♦', num: 7, strength: 5 }
    ];

    expect(isValidPlay(matching, field, rules, state).valid).toBe(true);
    expect(isValidPlay(mismatched, field, rules, state)).toMatchObject({
      valid: false,
      message: expect.stringContaining('完縛り')
    });
  });
});

describe('RoomManager 10捨て', () => {
  it('10を2枚出したときは捨てるカードも2枚必須', () => {
    const roomManager = RoomManager;
    const socketA = { id: 'sA' };
    const socketB = { id: 'sB' };

    roomManager.rooms = {};
    roomManager.createRoom(socketA, { roomId: 'ten-test', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom(socketB, { roomId: 'ten-test', playerName: 'B', playerId: 'p2' });

    const room = roomManager.rooms['ten-test'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'h1', suit: '♥', num: 10, strength: 10 },
      { id: 'h2', suit: '♦', num: 10, strength: 10 },
      { id: 'h3', suit: '♠', num: 3, strength: 3 },
      { id: 'h4', suit: '♣', num: 4, strength: 4 }
    ];
    room.players[1].hand = [{ id: 'x1', suit: '♠', num: 5, strength: 5 }];

    const missingDiscard = roomManager.playCards('sA', {
      roomId: 'ten-test',
      cards: [room.players[0].hand[0], room.players[0].hand[1]],
      discardCards: ['h3']
    });

    expect(missingDiscard.success).toBe(false);
    expect(missingDiscard.message).toContain('2枚');

    const valid = roomManager.playCards('sA', {
      roomId: 'ten-test',
      cards: [room.players[0].hand[0], room.players[0].hand[1]],
      discardCards: ['h3', 'h4']
    });

    expect(valid.success).toBe(true);
    expect(room.players[0].hand.length).toBe(0);
  });

  it('同じ捨て札IDを繰り返して枚数条件を満たせない', () => {
    const roomManager = RoomManager;
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'sA' }, { roomId: 'duplicate-discard', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom({ id: 'sB' }, { roomId: 'duplicate-discard', playerName: 'B', playerId: 'p2' });
    const room = roomManager.rooms['duplicate-discard'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'ten-a', suit: '♥', num: 10, strength: 10 },
      { id: 'ten-b', suit: '♦', num: 10, strength: 10 },
      { id: 'discard-a', suit: '♠', num: 3, strength: 3 },
      { id: 'discard-b', suit: '♣', num: 4, strength: 4 }
    ];

    const result = roomManager.playCards('sA', {
      roomId: 'duplicate-discard',
      cards: room.players[0].hand.slice(0, 2),
      discardCards: ['discard-a', 'discard-a']
    });

    expect(result.success).toBe(false);
    expect(room.players[0].hand).toHaveLength(4);
  });
});

describe('10捨て/7渡しの選択検証', () => {
  it('該当する効果を使わずに捨て札や渡し札を送れない', () => {
    const roomManager = RoomManager;
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'sA' }, { roomId: 'unexpected-side-cards', playerName: 'A', playerId: 'p1', rules: { tenDiscard: false, sevenPass: false } });
    roomManager.joinRoom({ id: 'sB' }, { roomId: 'unexpected-side-cards', playerName: 'B', playerId: 'p2' });
    const room = roomManager.rooms['unexpected-side-cards'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'play', suit: '♠', num: 3, strength: 3 },
      { id: 'discard', suit: '♥', num: 4, strength: 4 },
      { id: 'pass', suit: '♦', num: 5, strength: 5 }
    ];

    const result = roomManager.playCards('sA', {
      roomId: 'unexpected-side-cards',
      cards: [room.players[0].hand[0]],
      discardCards: ['discard'],
      passedCards: ['pass']
    });

    expect(result.success).toBe(false);
    expect(room.players[0].hand).toHaveLength(3);
  });
});
