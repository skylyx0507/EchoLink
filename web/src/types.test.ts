import { describe, it, expect } from 'vitest';
import type { JoinRoomMessage, JoinedRoomMessage, SignalingMessage } from './types';

describe('types / SignalingMessage', () => {
  it('joinRoom message has correct shape', () => {
    const msg: JoinRoomMessage = {
      type: 'joinRoom',
      roomId: 'test-room',
      peerId: 'alice',
    };
    expect(msg.type).toBe('joinRoom');
    expect(msg.roomId).toBe('test-room');
    expect(msg.peerId).toBe('alice');
  });

  it('joinedRoom message has correct shape', () => {
    const msg: JoinedRoomMessage = {
      type: 'joinedRoom',
      roomId: 'test-room',
      peerId: 'alice',
      rtpCapabilities: { codecs: [], headerExtensions: [] },
      existingPeers: ['bob'],
      existingProducers: [{ producerId: 'p1', peerId: 'bob' }],
    };
    expect(msg.existingPeers).toContain('bob');
    expect(msg.existingProducers).toHaveLength(1);
  });

  it('SignalingMessage union covers all types', () => {
    const messages: SignalingMessage[] = [
      { type: 'joinRoom', roomId: 'r', peerId: 'p' },
      { type: 'joinedRoom', roomId: 'r', peerId: 'p', rtpCapabilities: { codecs: [], headerExtensions: [] }, existingPeers: [], existingProducers: [] },
      { type: 'createTransport', direction: 'send' },
      { type: 'transportCreated', direction: 'send', id: 't1', iceParameters: { usernameFragment: 'u', password: 'p' }, iceCandidates: [], dtlsParameters: { fingerprints: [] } },
      { type: 'connectTransport', transportId: 't1', dtlsParameters: { fingerprints: [] } },
      { type: 'transportConnected', transportId: 't1' },
      { type: 'produce', kind: 'audio', rtpParameters: { codecs: [], headerExtensions: [], encodings: [] } },
      { type: 'produced', producerId: 'p1' },
      { type: 'newProducer', producerId: 'p1', peerId: 'bob', kind: 'audio' },
      { type: 'consume', producerId: 'p1', rtpCapabilities: { codecs: [], headerExtensions: [] } },
      { type: 'consumed', consumerId: 'c1', producerId: 'p1', kind: 'audio', rtpParameters: { codecs: [], headerExtensions: [], encodings: [] } },
      { type: 'resumeConsuming', consumerId: 'c1' },
      { type: 'consumerResumed', consumerId: 'c1' },
      { type: 'peerJoined', peerId: 'bob' },
      { type: 'peerLeft', peerId: 'bob' },
      { type: 'producerClosed', producerId: 'p1', peerId: 'bob' },
      { type: 'authenticate', token: 'jwt-token' },
      { type: 'authenticated', userId: 1, username: 'alice', displayName: 'Alice' },
      { type: 'authError', message: 'invalid token' },
      { type: 'listRooms' },
      { type: 'roomsList', rooms: [{ roomId: 'r', peerCount: 2 }] },
      { type: 'error', message: 'oops' },
    ];

    for (const msg of messages) {
      expect(msg.type).toBeDefined();
    }
  });
});
