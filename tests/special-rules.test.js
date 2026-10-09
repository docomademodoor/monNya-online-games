import { describe, it, expect } from 'vitest';
import roomManager from '../src/game/roomManager.js';
import { applyCardEffects } from '../src/game/daifugo/cardEffects.js';
import { checkForbiddenFinish } from '../public/js/rules.js';

describe('特殊効果テスト', () => {
  it('4枚階段は通常革命と重複反転せず、8切りより先に階段革命する', () => {
    const room = {
      rules: {
        revolution: true,
        staircase: true,
        staircaseRevolution: true,
        eightCut: true,
        suitLock: false,
        elevenBack: false,
        fiveSkip: false,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      passCount: 0,
      winners: [],
      players: [{ id: 'p1', hand: [] }, { id: 'p2', hand: [{ id: 'other', suit: '♥', num: 3 }] }]
    };
    const cards = [6, 7, 8, 9].map((num, index) => ({
      id: `stair-${index}`,
      suit: '♠',
      num,
      strength: index + 4
    }));

    const result = applyCardEffects(room, { id: 'p1', name: 'A', hand: [] }, cards, { valid: true });
    const log = result.actionLogs.join(' ');

    expect(room.isRevolution).toBe(true);
    expect(result.clearField).toBe(true);
    expect(log).toContain('階段革命！');
    expect(log).not.toContain('【革命！】');
  });

  it('スートが異なる連続ランクの連続プレイで次の数字を縛る', () => {
    const room = {
      rules: { numberLock: true },
      fieldCards: [{ id: 'previous', suit: '♥', num: 6 }],
      passCount: 0
    };
    const player = { name: 'A', id: 'p1', hand: [] };

    applyCardEffects(room, player, [{ id: 'current', suit: '♠', num: 7 }], {});

    expect(room.lockedNumber).toBe('8');
  });

  it('同じ枚数のペアが連続した場合も次の数字を縛る', () => {
    const room = {
      rules: { numberLock: true },
      fieldCards: [
        { id: 'previous-1', suit: '♥', num: 6 },
        { id: 'previous-2', suit: '♦', num: 6 }
      ],
      passCount: 0
    };
    const player = { name: 'A', id: 'p1', hand: [] };

    applyCardEffects(room, player, [
      { id: 'current-1', suit: '♠', num: 7 },
      { id: 'current-2', suit: '♣', num: 7 }
    ], {});

    expect(room.lockedNumber).toBe('8');
  });

  it('完縛りは同じスート構成の連続ランクだけで始まる', () => {
    const room = {
      rules: { numberLock: false, completeLock: true },
      fieldCards: [
        { id: 'previous-spade-6', suit: '♠', num: 6 },
        { id: 'previous-heart-6', suit: '♥', num: 6 }
      ],
      passCount: 0,
      lockedNumber: null,
      lockedNumberSuits: null
    };
    const player = { id: 'p1', name: 'A', hand: [] };

    applyCardEffects(room, player, [
      { id: 'current-heart-7', suit: '♥', num: 7 },
      { id: 'current-spade-7', suit: '♠', num: 7 }
    ], {});

    expect(room.lockedNumber).toBe('8');
    expect(room.lockedNumberSuits).toEqual(['♠', '♥']);
  });

  it('完縛りは異なるスート構成の連続ランクでは始まらない', () => {
    const room = {
      rules: { numberLock: false, completeLock: true },
      fieldCards: [
        { id: 'previous-spade-6', suit: '♠', num: 6 },
        { id: 'previous-heart-6', suit: '♥', num: 6 }
      ],
      passCount: 0,
      lockedNumber: null,
      lockedNumberSuits: null
    };
    const player = { id: 'p1', name: 'A', hand: [] };

    applyCardEffects(room, player, [
      { id: 'current-club-7', suit: '♣', num: 7 },
      { id: 'current-diamond-7', suit: '♦', num: 7 }
    ], {});

    expect(room.lockedNumber).toBeNull();
    expect(room.lockedNumberSuits).toBeNull();
  });

  it('階段を出しただけでは数字縛りにならない', () => {
    const room = { rules: { numberLock: true }, fieldCards: [], passCount: 0 };
    const player = { name: 'A', id: 'p1', hand: [] };

    applyCardEffects(room, player, [
      { id: 'stair-1', suit: '♥', num: 6 },
      { id: 'stair-2', suit: '♥', num: 7 },
      { id: 'stair-3', suit: '♥', num: 8 }
    ], {});

    expect(room.lockedNumber).toBeUndefined();
  });

  it('追加選択の必要枚数を手札の残りと効果カード数から算出する', () => {
    const room = { rules: { sevenPass: true, tenDiscard: true } };
    const player = { hand: [
      { id: 'seven', num: 7 },
      { id: 'ten', num: 10 },
      { id: 'pass-card', num: 4 },
      { id: 'discard-card', num: 6 }
    ] };

    expect(roomManager.getSideSelectionRequirements(room, player, [player.hand[0], player.hand[1]]))
      .toEqual({ pass: 1, discard: 1 });
    expect(roomManager.getSideSelectionRequirements(room, player, [{ id: 'plain', num: 9 }]))
      .toEqual({ pass: 0, discard: 0 });
  });

  it('7の4枚とジョーカーは7渡しを5枚分として扱う', () => {
    const room = { rules: { sevenPass: true, tenDiscard: true } };
    const player = { hand: [
      { id: 'seven-1', num: 7 },
      { id: 'seven-2', num: 7 },
      { id: 'seven-3', num: 7 },
      { id: 'seven-4', num: 7 },
      { id: 'joker', num: 'JOKER', id: 'JOKER' },
      { id: 'pass-1', num: 4 },
      { id: 'pass-2', num: 5 },
      { id: 'pass-3', num: 6 },
      { id: 'pass-4', num: 8 },
      { id: 'pass-5', num: 9 },
      { id: 'pass-6', num: 10 }
    ] };

    expect(roomManager.getSideSelectionRequirements(room, player, player.hand.slice(0, 5)))
      .toEqual({ pass: 5, discard: 0 });
  });

  it('10の4枚とジョーカーは10捨てを5枚分として扱う', () => {
    const room = { rules: { sevenPass: true, tenDiscard: true } };
    const player = { hand: [
      { id: 'ten-1', num: 10 },
      { id: 'ten-2', num: 10 },
      { id: 'ten-3', num: 10 },
      { id: 'ten-4', num: 10 },
      { id: 'JOKER', num: 'JOKER' },
      { id: 'discard-1', num: 4 },
      { id: 'discard-2', num: 5 },
      { id: 'discard-3', num: 6 },
      { id: 'discard-4', num: 7 },
      { id: 'discard-5', num: 8 },
      { id: 'discard-6', num: 9 }
    ] };

    expect(roomManager.getSideSelectionRequirements(room, player, player.hand.slice(0, 5)))
      .toEqual({ pass: 0, discard: 5 });
  });

  it('プレイ要求のカード属性をクライアントが改ざんできない', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'canonical-play', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'canonical-play', playerName: 'B', playerId: 'p2' });
    const room = roomManager.rooms['canonical-play'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [{ id: 'top', suit: '♠', num: 9, strength: 7 }];
    room.players[0].hand = [{ id: 'held-3', suit: '♥', num: 3, strength: 1 }];
    room.players[1].hand = [{ id: 'other', suit: '♣', num: 4, strength: 2 }];

    const result = roomManager.playCards('host', {
      roomId: 'canonical-play',
      cards: [{ id: 'held-3', suit: '♠', num: 2, strength: 15 }]
    });

    expect(result.success).toBe(false);
    expect(room.players[0].hand).toEqual([{ id: 'held-3', suit: '♥', num: 3, strength: 1 }]);
    expect(room.fieldCards).toEqual([{ id: 'top', suit: '♠', num: 9, strength: 7 }]);
  });

  it('同じカードIDを複数枚指定できない', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'duplicate-play', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'duplicate-play', playerName: 'B', playerId: 'p2' });
    const room = roomManager.rooms['duplicate-play'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    const heldCard = { id: 'held-5', suit: '♠', num: 5, strength: 3 };
    room.players[0].hand = [heldCard];

    const result = roomManager.playCards('host', {
      roomId: 'duplicate-play',
      cards: [heldCard, heldCard]
    });

    expect(result.success).toBe(false);
    expect(room.players[0].hand).toEqual([heldCard]);
    expect(room.fieldCards).toEqual([]);
  });

  it('追加カード選択を一時停止した後は最初に選んだプレイ札を固定する', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'pending-side-selection', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'pending-side-selection', playerName: 'B', playerId: 'p2' });
    const room = roomManager.rooms['pending-side-selection'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'ten', suit: '♥', num: 10, strength: 8 },
      { id: 'other', suit: '♠', num: 3, strength: 1 },
      { id: 'discard', suit: '♣', num: 5, strength: 3 }
    ];
    room.pendingSideSelection = { playerId: 'host', cardIds: ['ten'], requirements: { pass: 0, discard: 1 } };

    const result = roomManager.playCards('host', {
      roomId: 'pending-side-selection',
      cards: ['other'],
      discardCards: ['discard']
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('最初に選んだカード');
    expect(room.players[0].hand.map(card => card.id)).toEqual(['ten', 'other', 'discard']);
  });

  it('カード交換にはサーバー上の正規カードを渡す', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, { roomId: 'canonical-exchange', playerName: 'A', playerId: 'p1', rules: {} });
    roomManager.joinRoom({ id: 'guest' }, { roomId: 'canonical-exchange', playerName: 'B', playerId: 'p2' });
    roomManager.joinRoom({ id: 'hinmin' }, { roomId: 'canonical-exchange', playerName: 'C', playerId: 'p3' });
    roomManager.joinRoom({ id: 'daihinmin' }, { roomId: 'canonical-exchange', playerName: 'D', playerId: 'p4' });
    const room = roomManager.rooms['canonical-exchange'];
    const host = room.players[0];
    const guest = room.players[3];
    host.role = '大富豪';
    room.players[1].role = '富豪';
    room.players[2].role = '貧民';
    guest.role = '大貧民';
    host.hand = [
      { id: 'card-a', suit: '♥', num: 3, strength: 1 },
      { id: 'card-b', suit: '♦', num: 4, strength: 2 }
    ];
    guest.hand = [];
    room.status = 'waiting-exchange';
    room.exchangeRequirements = { host: 2 };

    const result = roomManager.submitExchangeCards('host', {
      roomId: 'canonical-exchange',
      cards: [
        { id: 'card-a', suit: '♠', num: 2, strength: 15 },
        { id: 'card-b', suit: '♠', num: 2, strength: 15 }
      ]
    });

    expect(result.success).toBe(true);
    expect(guest.hand).toEqual([
      { id: 'card-a', suit: '♥', num: 3, strength: 1 },
      { id: 'card-b', suit: '♦', num: 4, strength: 2 }
    ]);
  });

  it('7渡しで次の人にカードが移る', () => {
    roomManager.rooms = {};

    roomManager.createRoom({ id: 'host' }, {
      roomId: 'seven-room',
      playerName: 'A',
      playerId: 'p1',
      rules: {}
    });
    roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'seven-room',
      playerName: 'B',
      playerId: 'p2'
    });

    const room = roomManager.rooms['seven-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: 'played-7', suit: '♥', num: 7, strength: 7 },
      { id: 'pass-7', suit: '♠', num: 7, strength: 7 },
      { id: 'keep-3', suit: '♣', num: 3, strength: 3 }
    ];
    room.players[1].hand = [{ id: 'reply-5', suit: '♦', num: 5, strength: 5 }];

    const result = roomManager.playCards('host', {
      roomId: 'seven-room',
      cards: [{ id: 'played-7', suit: '♥', num: 7, strength: 7 }],
      passedCards: ['pass-7']
    });

    expect(result.success).toBe(true);
    expect(room.players[1].hand.some(c => c.id === 'pass-7')).toBe(true);
    expect(room.actionMessage).not.toContain('渡しました');
    expect(room.actionMessage).not.toContain('♠7');
  });

  it('7を3枚出して残り1枚を渡した場合に上がれる', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, {
      roomId: 'seven-finish-room',
      playerName: 'A',
      playerId: 'p1',
      rules: { sevenPass: true, tenDiscard: false }
    });
    roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'seven-finish-room',
      playerName: 'B',
      playerId: 'p2'
    });

    const room = roomManager.rooms['seven-finish-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: '7a', suit: '♥', num: 7, strength: 7 },
      { id: '7b', suit: '♦', num: 7, strength: 7 },
      { id: '7c', suit: '♠', num: 7, strength: 7 },
      { id: 'last-card', suit: '♣', num: 5, strength: 5 }
    ];
    room.players[1].hand = [{ id: 'reply', suit: '♠', num: 4, strength: 4 }];

    const result = roomManager.playCards('host', {
      roomId: 'seven-finish-room',
      cards: room.players[0].hand.slice(0, 3),
      passedCards: ['last-card']
    });

    expect(result.success).toBe(true);
    expect(room.players[0].hand).toHaveLength(0);
    expect(room.players[0].isWinner).toBe(true);
    expect(room.winners.filter(player => player.id === 'host')).toHaveLength(1);
    expect(room.players[1].hand.some(card => card.id === 'last-card')).toBe(true);
  });

  it('10を3枚出して残り1枚を捨てた場合に上がれる', () => {
    roomManager.rooms = {};
    roomManager.createRoom({ id: 'host' }, {
      roomId: 'ten-finish-room',
      playerName: 'A',
      playerId: 'p1',
      rules: { tenDiscard: true, sevenPass: false }
    });
    roomManager.joinRoom({ id: 'guest' }, {
      roomId: 'ten-finish-room',
      playerName: 'B',
      playerId: 'p2'
    });

    const room = roomManager.rooms['ten-finish-room'];
    room.status = 'playing';
    room.turnIndex = 0;
    room.fieldCards = [];
    room.players[0].hand = [
      { id: '10a', suit: '♥', num: 10, strength: 10 },
      { id: '10b', suit: '♦', num: 10, strength: 10 },
      { id: '10c', suit: '♠', num: 10, strength: 10 },
      { id: 'last-card', suit: '♣', num: 5, strength: 5 }
    ];
    room.players[1].hand = [{ id: 'reply', suit: '♠', num: 4, strength: 4 }];

    const result = roomManager.playCards('host', {
      roomId: 'ten-finish-room',
      cards: room.players[0].hand.slice(0, 3),
      discardCards: ['last-card']
    });

    expect(result.success).toBe(true);
    expect(room.players[0].hand).toHaveLength(0);
    expect(room.players[0].isWinner).toBe(true);
    expect(room.winners.filter(player => player.id === 'host')).toHaveLength(1);
  });

  it('8×3 + JOKER でも革命が発生する', () => {
    const room = {
      rules: {
        eightCut: true,
        revolution: true,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: false,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: [],
      players: [
        { id: 'p1', name: 'A', hand: [] },
        { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♠', num: 3, strength: 3 }] },
        { id: 'p3', name: 'C', hand: [{ id: 'c1', suit: '♦', num: 4, strength: 4 }] }
      ]
    };

    const currentPlayer = { name: 'A', hand: [], id: 'p1' };
    const playedCards = [
      { id: 'h8', suit: '♥', num: 8, strength: 8 },
      { id: 'd8', suit: '♦', num: 8, strength: 8 },
      { id: 's8', suit: '♠', num: 8, strength: 8 },
      { id: 'JOKER', suit: 'JOKER', num: null, strength: 15 }
    ];

    const result = applyCardEffects(room, currentPlayer, playedCards, { valid: true });

    expect(room.isRevolution).toBe(true);
    expect(result.actionLogs.join(' ')).toContain('革命');
  });

  it('革命中のJバックは合算後の最強数字を表示する', () => {
    const room = {
      rules: {
        eightCut: false,
        revolution: false,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: true,
        fiveSkip: false,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [{ id: 'field-4', suit: '♣', num: 4, strength: 2 }],
      isRevolution: true,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      passCount: 0,
      winners: [],
      players: [{ id: 'p1', hand: [] }, { id: 'p2', hand: [] }]
    };
    const player = { id: 'p1', name: 'A', hand: [] };

    const result = applyCardEffects(room, player, [
      { id: 'spade-J', suit: '♠', num: 'J', strength: 9 }
    ], { valid: true });
    const message = result.actionLogs.join(' ');

    expect(room.isElevenBack).toBe(true);
    expect(message).toContain('2が最強');
    expect(message).not.toContain('3が最強');
  });

  it('5飛びは自分以外の人数分以上で自分のターンに戻る', () => {
    const room = {
      rules: {
        eightCut: false,
        revolution: false,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: true,
        tenDiscard: false,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: [],
      players: [
        { id: 'p1', name: 'A', hand: [{ id: 'a5', suit: '♠', num: 5, strength: 5 }] },
        { id: 'p2', name: 'B', hand: [{ id: 'b1', suit: '♥', num: 7, strength: 7 }] },
        { id: 'p3', name: 'C', hand: [{ id: 'c1', suit: '♦', num: 8, strength: 8 }] }
      ]
    };

    const currentPlayer = room.players[0];
    const result = applyCardEffects(room, currentPlayer, [
      { id: 'a5', suit: '♠', num: 5, strength: 5 },
      { id: 'a6', suit: '♣', num: 5, strength: 5 }
    ], { valid: true });

    expect(result.skipCount).toBe(3);
    expect(result.actionLogs.join(' ')).toContain('5飛び');
  });

  it('10捨てで指定枚数だけ捨てられる', () => {
    const room = {
      rules: {
        eightCut: false,
        revolution: false,
        staircaseRevolution: false,
        suitLock: false,
        numberLock: false,
        elevenBack: false,
        fiveSkip: false,
        tenDiscard: true,
        sevenPass: false
      },
      fieldCards: [],
      isRevolution: false,
      isElevenBack: false,
      lockedSuit: null,
      lockedNumber: null,
      winners: []
    };

    const currentPlayer = {
      name: 'A',
      hand: [
        { id: 'h10', suit: '♥', num: 10, strength: 10 },
        { id: 'h10b', suit: '♦', num: 10, strength: 10 },
        { id: 'h3', suit: '♠', num: 3, strength: 3 },
        { id: 'h4', suit: '♣', num: 4, strength: 4 }
      ]
    };

    const result = applyCardEffects(room, currentPlayer, [
      { id: 'h10', suit: '♥', num: 10, strength: 10 },
      { id: 'h10b', suit: '♦', num: 10, strength: 10 }
    ], { valid: true });

    const actionMessage = result.actionLogs.join(' ');
    expect(actionMessage).not.toContain('10捨て');
    expect(actionMessage).not.toContain('捨てました');
    expect(currentPlayer.hand.length).toBe(2);
  });

  it('禁止上がりで反則扱いになる', () => {
    const result = checkForbiddenFinish(
      [{ id: 'h8', suit: '♥', num: 8, strength: 8 }],
      1,
      { forbiddenFinish: true, eightCut: true },
      { isRevolution: false, isElevenBack: false, isSpe3: false }
    );

    expect(result.isForbidden).toBe(true);
    expect(result.reason).toContain('8切り');
  });
});
