import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const roomManager = require('../src/game/roomManager.js');

describe('チンチロのルーム進行', () => {
  const roomId = 'chinchiro-test-room';
  const host = { id: 'host' };
  const guest = { id: 'guest' };

  beforeEach(() => {
    delete roomManager.rooms[roomId];
  });

  function createPlayingRoom() {
    roomManager.createRoom(host, {
      roomId,
      playerName: 'ホスト',
      gameType: 'chinchiro'
    });
    roomManager.joinRoom(guest, {
      roomId,
      playerName: 'ゲスト'
    });
    return roomManager.startGame(host.id, roomId).room;
  }

  function placeGuestBet(room, amount = 10) {
    return roomManager.performGameAction(guest.id, roomId, 'placeBet', amount);
  }

  it('最大8人のルームでカードを配らずに対戦を開始する', () => {
    const room = createPlayingRoom();

    expect(room.maxPlayers).toBe(8);
    expect(room.status).toBe('playing');
    expect(room.rules).toEqual({});
    expect(room.chinchiroPhase).toBe('betting');
    expect(room.chinchiroParentId).toBe(host.id);
    expect(room.players.every(player => player.soshies === 1000)).toBe(true);
    expect(room.players.every(player => player.hand.length === 0)).toBe(true);
  });

  it('履歴が60件に達した後もロールIDが一意に増加する', () => {
    const room = createPlayingRoom();
    room.chinchiroHistory = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      round: 0,
      playerId: 'previous-player',
      playerName: '前ラウンド',
      dice: [1, 2, 3],
      label: '役なし',
      rollNumber: 1,
      confirmed: false
    }));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(placeGuestBet(room).success).toBe(true);
      expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);

      expect(room.chinchiroHistory).toHaveLength(60);
      expect(room.chinchiroHistory.slice(-2).map(entry => entry.id)).toEqual([61, 62]);
      expect(new Set(room.chinchiroHistory.map(entry => entry.id)).size).toBe(60);
    } finally {
      random.mockRestore();
    }
  });

  it('8人までは参加でき、9人目は拒否する', () => {
    roomManager.createRoom(host, { roomId, playerName: 'ホスト', gameType: 'chinchiro' });
    for (let player = 2; player <= 8; player++) {
      expect(roomManager.joinRoom({ id: `guest-${player}` }, {
        roomId,
        playerName: `ゲスト${player}`
      }).success).toBe(true);
    }

    const ninthPlayer = roomManager.joinRoom({ id: 'guest-9' }, {
      roomId,
      playerName: 'ゲスト9'
    });

    expect(roomManager.rooms[roomId].players).toHaveLength(8);
    expect(ninthPlayer).toMatchObject({ success: false });
    expect(ninthPlayer.message).toContain('最大8人');
  });

  it('子は最大3投し、親が最後に振った後ソシーで精算する', () => {
    const room = createPlayingRoom();
    const diceRolls = [
      0.01, 0.2, 0.8,
      0.01, 0.2, 0.8,
      0.01, 0.2, 0.8,
      0, 0, 0
    ];
    const random = vi.spyOn(Math, 'random').mockImplementation(() => diceRolls.shift());

    try {
      expect(placeGuestBet(room, 10).success).toBe(true);
      for (let roll = 0; roll < 3; roll++) {
        expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      }
      expect(room.status).toBe('playing');
      expect(room.players[1].rollsUsed).toBe(3);
      expect(room.players[1].chinchiroFinished).toBe(true);
      expect(room.chinchiroHistory.at(-1).confirmed).toBe(true);
      expect(room.players[room.turnIndex].id).toBe(host.id);
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);
      expect(room.status).toBe('finished');
      expect(room.completedRounds).toBe(1);
      expect(room.players.find(player => player.id === guest.id).soshies).toBe(950);
      expect(room.players.find(player => player.id === host.id).soshies).toBe(1050);
      expect(room.players.find(player => player.id === guest.id).rank).toBe(2);
      expect(room.players.find(player => player.id === host.id).rank).toBe(1);
    } finally {
      random.mockRestore();
    }
  });

  it('賭けがそろうまではサイコロを振れない', () => {
    const room = createPlayingRoom();

    expect(roomManager.performGameAction(host.id, roomId, 'roll')).toMatchObject({
      success: false,
      message: 'チンチロのゲーム中ではありません'
    });
    expect(room.chinchiroPhase).toBe('betting');
  });

  it('子の役が出たら自動確定して親へ手番を移す', () => {
    const room = createPlayingRoom();
    const diceRolls = [0.51, 0.67, 0.84];
    const random = vi.spyOn(Math, 'random').mockImplementation(() => diceRolls.shift());

    try {
      expect(placeGuestBet(room).success).toBe(true);
      expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      expect(room.turnIndex).toBe(0);
      expect(room.players[1].chinchiroFinished).toBe(true);
      expect(room.players[1].rollsUsed).toBe(1);
      expect(room.chinchiroHistory[0].confirmed).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it('賭け額の少ない子から振り、親は最後に振る', () => {
    const orderRoomId = 'chinchiro-bet-order';
    delete roomManager.rooms[orderRoomId];
    roomManager.createRoom(host, {
      roomId: orderRoomId,
      playerName: 'ホスト',
      gameType: 'chinchiro'
    });
    ['guest-1', 'guest-2', 'guest-3'].forEach((id, index) => {
      roomManager.joinRoom({ id }, { roomId: orderRoomId, playerName: `ゲスト${index + 1}` });
    });
    roomManager.startGame(host.id, orderRoomId);

    expect(roomManager.performGameAction('guest-1', orderRoomId, 'placeBet', 50).success).toBe(true);
    expect(roomManager.performGameAction('guest-2', orderRoomId, 'placeBet', 10).success).toBe(true);
    const lastBet = roomManager.performGameAction('guest-3', orderRoomId, 'placeBet', 20);

    expect(lastBet.success).toBe(true);
    expect(lastBet.room.chinchiroTurnOrder).toEqual(['guest-2', 'guest-3', 'guest-1', host.id]);
    expect(lastBet.room.players[lastBet.room.turnIndex].id).toBe('guest-2');
  });

  it('参加者変更で順位シリーズをリセットするとソシーも初期残高へ戻る', () => {
    const room = createPlayingRoom();
    room.status = 'finished';
    room.completedRounds = 2;
    room.players[0].soshies = 120;
    room.players[1].soshies = 1880;

    const result = roomManager.addCpuPlayer(host.id, roomId);

    expect(result.success).toBe(true);
    expect(room.completedRounds).toBe(0);
    expect(room.players.slice(0, 2).map(player => player.soshies)).toEqual([1000, 1000]);
  });

  it('シゴロで勝つと賭け額の2倍をソシーで受け取る', () => {
    const room = createPlayingRoom();
    const dice = [0.51, 0.67, 0.84, 0.01, 0.2, 0.35];
    const random = vi.spyOn(Math, 'random').mockImplementation(() => dice.shift());

    try {
      expect(placeGuestBet(room, 50).success).toBe(true);
      expect(roomManager.performGameAction(guest.id, roomId, 'roll').success).toBe(true);
      expect(roomManager.performGameAction(host.id, roomId, 'roll').success).toBe(true);

      expect(room.players.find(player => player.id === guest.id).soshies).toBe(1100);
      expect(room.players.find(player => player.id === host.id).soshies).toBe(900);
    } finally {
      random.mockRestore();
    }
  });
});