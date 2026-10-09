import { describe, it, expect } from 'vitest';
import roomManager from '../src/game/roomManager.js';

describe('勝敗・役割判定', () => {
  it('1人残ったときにゲーム終了状態になる', () => {
    roomManager.rooms = {};

    const host = { id: 'host' };
    roomManager.createRoom(host, {
      roomId: 'endgame-room',
      playerName: 'A',
      playerId: 'a',
      rules: {}
    });

    const room = roomManager.rooms['endgame-room'];
    room.status = 'playing';
    room.players.push({
      id: 'guest',
      playerId: 'b',
      name: 'B',
      hand: [],
      isWinner: false,
      rank: null,
      role: null,
      connected: true
    });

    room.players[0].hand = [{ id: 'h1', suit: '♥', num: 1, strength: 1 }];
    room.players[1].hand = [];

    roomManager.checkGameCompletion(room);

    expect(room.status).toBe('finished');
  });

  it('2〜6人それぞれに指定の順位役職を割り当てる', () => {
    const expectedRoles = {
      2: ['富豪', '貧民'],
      3: ['富豪', '平民', '貧民'],
      4: ['大富豪', '富豪', '貧民', '大貧民'],
      5: ['大富豪', '富豪', '平民', '貧民', '大貧民'],
      6: ['大富豪', '富豪', '平民', '平民', '貧民', '大貧民']
    };

    Object.entries(expectedRoles).forEach(([countText, roles]) => {
      const count = Number(countText);
      const room = {
        players: roles.map((_, index) => ({
          id: `p${index + 1}`,
          name: `P${index + 1}`,
          hand: [],
          rank: index + 1,
          role: null
        })),
        winners: [],
        previousRoles: {}
      };

      roomManager.assignRoles(room);

      expect(room.players.map(player => player.role), `${count}人戦`).toEqual(roles);
    });
  });

  it('都落ちで最下位を予約済みなら最後のプレイヤーへ未使用順位を割り当てる', () => {
    roomManager.rooms = {};
    const room = {
      status: 'playing',
      players: [
        { id: 'previous-daifugo', name: 'A', hand: [], rank: 5, role: '大貧民' },
        { id: 'first', name: 'B', hand: [], rank: 1, role: null },
        { id: 'second', name: 'C', hand: [], rank: 2, role: null },
        { id: 'third', name: 'D', hand: [], rank: 3, role: null },
        { id: 'last', name: 'E', hand: [{ id: 'remaining-card' }], rank: null, role: null }
      ],
      winners: [],
      previousRoles: {}
    };

    roomManager.checkGameCompletion(room);

    expect(room.status).toBe('finished');
    expect(room.players.find(player => player.id === 'last').rank).toBe(4);
    expect(room.players.map(player => player.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('役職別ポイントを累積し、同じラウンドを二重加算しない', () => {
    const room = {
      status: 'playing',
      players: [
        { id: 'first', name: 'A', hand: [], rank: 1, totalPoints: 4 },
        { id: 'second', name: 'B', hand: [], rank: 2, totalPoints: 3 },
        { id: 'third', name: 'C', hand: [], rank: 3, totalPoints: 2 },
        { id: 'fourth', name: 'D', hand: [], rank: 4, totalPoints: 1 },
        { id: 'last', name: 'E', hand: [{ id: 'remaining' }], rank: null, totalPoints: 0 }
      ],
      winners: [],
      previousRoles: null,
      completedRounds: 1
    };

    roomManager.checkGameCompletion(room);
    roomManager.checkGameCompletion(room);

    expect(room.completedRounds).toBe(2);
    expect(room.players.map(player => player.totalPoints)).toEqual([7, 5, 2, 0, -2]);
  });
});
