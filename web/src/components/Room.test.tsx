import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
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

describe('Room component', () => {
  it('renders login form when not joined', () => {
    render(
      <BrowserRouter>
        <Room />
      </BrowserRouter>
    );

    expect(screen.getByText('EchoLink')).toBeInTheDocument();
    expect(screen.getByText('游戏语音，低延迟沟通')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('IP 或 IP:端口（不填端口自动嗅探）')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('输入房间号加入或创建')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('你的游戏昵称')).toBeInTheDocument();
    expect(screen.getByText('进入语音房间')).toBeInTheDocument();
  });

  it('server address input has default value from hostname', () => {
    render(
      <BrowserRouter>
        <Room />
      </BrowserRouter>
    );

    const serverInput = screen.getByPlaceholderText('IP 或 IP:端口（不填端口自动嗅探）') as HTMLInputElement;
    expect(serverInput.value).toBe(window.location.hostname);
  });
});
