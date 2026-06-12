import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Room } from './Room';

// Mock mediasoup-client to avoid WebRTC errors in jsdom
vi.mock('mediasoup-client', () => ({
  Device: class MockDevice {
    async load() {}
    get rtpCapabilities() { return { codecs: [], headerExtensions: [] }; }
    createSendTransport() { return { on: vi.fn(), produce: vi.fn() }; }
    createRecvTransport() { return { on: vi.fn(), consume: vi.fn() }; }
  },
  types: {},
}));

// Mock AudioWorklet
Object.defineProperty(globalThis, 'AudioContext', {
  value: class MockAudioContext {
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
    createAnalyser = vi.fn(() => ({ connect: vi.fn(), fftSize: 0, smoothingTimeConstant: 0 }));
    createMediaStreamDestination = vi.fn(() => ({ stream: { getAudioTracks: () => [] } }));
    audioWorklet = { addModule: vi.fn() };
    close = vi.fn();
  },
});

// Mock WebSocket so the auto-join effect does not throw.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor() {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send() {}
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

Object.defineProperty(globalThis, 'WebSocket', { value: MockWebSocket });

describe('Room component', () => {
  it('renders loading state when joining a room', () => {
    render(
      <MemoryRouter initialEntries={["/room/test-room"]}>
        <Routes>
          <Route path="/room/:roomId" element={<Room />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('正在加入房间...')).toBeInTheDocument();
    expect(screen.getByText('test-room')).toBeInTheDocument();
  });
});
