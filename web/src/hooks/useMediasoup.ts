import { useEffect, useRef, useState, useCallback } from "react";
import { Device } from "mediasoup-client";
import { types } from "mediasoup-client";
import type {
  SignalingMessage,
  PeerInfo,
  RoomState,
  TransportCreatedMessage,
  ConsumedMessage,
} from "../types";

const WS_URL = `ws://${window.location.host}/ws`;

// 降噪档位配置
export type NoiseLevel = "off" | "low" | "medium" | "high";

export const NOISE_PRESETS: Record<NoiseLevel, { label: string; gateThreshold: number; vadThreshold: number }> = {
  off: { label: "关闭", gateThreshold: 0, vadThreshold: 0.025 },
  low: { label: "低", gateThreshold: 0.01, vadThreshold: 0.02 },
  medium: { label: "中", gateThreshold: 0.02, vadThreshold: 0.03 },
  high: { label: "高", gateThreshold: 0.04, vadThreshold: 0.05 },
};

export function useMediasoup() {
  const [roomState, setRoomState] = useState<RoomState>({
    roomId: "",
    peerId: "",
    joined: false,
    micEnabled: false,
    peers: new Map(),
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [noiseLevel, setNoiseLevel] = useState<NoiseLevel>("medium");
  const [latency, setLatency] = useState<number>(0);

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<types.Transport | null>(null);
  const recvTransportRef = useRef<types.Transport | null>(null);
  const producerRef = useRef<types.Producer | null>(null);
  const consumersRef = useRef<Map<string, types.Consumer>>(new Map());
  const peersRef = useRef<Map<string, PeerInfo>>(new Map());
  const pendingConsumesRef = useRef<
    Array<{ producerId: string; peerId: string }>
  >([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const noiseSuppressorRef = useRef<AudioWorkletNode | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const messageHandlersRef = useRef<Map<string, (msg: SignalingMessage) => void>>(new Map());
  const latencyIntervalRef = useRef<number | null>(null);

  // 发送信令消息
  const send = useCallback((msg: SignalingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // 等待特定类型的消息
  const waitForMessage = useCallback((type: string): Promise<SignalingMessage> => {
    return new Promise((resolve) => {
      const handler = (msg: SignalingMessage) => {
        messageHandlersRef.current.delete(type);
        resolve(msg);
      };
      messageHandlersRef.current.set(type, handler);
    });
  }, []);

  // 创建发送 transport
  const createSendTransport = useCallback(async () => {
    send({ type: "createTransport", direction: "send" });

    const msg = await waitForMessage("transportCreated") as TransportCreatedMessage;
    const device = deviceRef.current;
    if (!device) throw new Error("Device not initialized");

    const transport = device.createSendTransport({
      id: msg.id,
      iceParameters: msg.iceParameters,
      iceCandidates: msg.iceCandidates,
      dtlsParameters: msg.dtlsParameters,
    });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      send({
        type: "connectTransport",
        transportId: transport.id,
        dtlsParameters,
      });

      const handleConnect = (m: SignalingMessage) => {
        if (m.type === "transportConnected" && m.transportId === transport.id) {
          callback();
        } else if (m.type === "error") {
          errback(new Error(m.message));
        }
      };
      messageHandlersRef.current.set("transportConnected", handleConnect);
    });

    transport.on(
      "produce",
      ({ kind, rtpParameters }, callback, errback) => {
        send({ type: "produce", kind, rtpParameters });

        const handleProduced = (m: SignalingMessage) => {
          if (m.type === "produced") {
            callback({ id: m.producerId });
          } else if (m.type === "error") {
            errback(new Error(m.message));
          }
        };
        messageHandlersRef.current.set("produced", handleProduced);
      }
    );

    transport.on("connectionstatechange", (state) => {
      console.log(`Send transport [${transport.id}] connection state: ${state}`);
    });

    sendTransportRef.current = transport;
  }, [send, waitForMessage]);

  // 创建接收 transport
  const createRecvTransport = useCallback(async () => {
    send({ type: "createTransport", direction: "recv" });

    const msg = await waitForMessage("transportCreated") as TransportCreatedMessage;
    const device = deviceRef.current;
    if (!device) throw new Error("Device not initialized");

    const transport = device.createRecvTransport({
      id: msg.id,
      iceParameters: msg.iceParameters,
      iceCandidates: msg.iceCandidates,
      dtlsParameters: msg.dtlsParameters,
    });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      send({
        type: "connectTransport",
        transportId: transport.id,
        dtlsParameters,
      });

      const handleConnect = (m: SignalingMessage) => {
        if (m.type === "transportConnected" && m.transportId === transport.id) {
          callback();
        } else if (m.type === "error") {
          errback(new Error(m.message));
        }
      };
      messageHandlersRef.current.set("transportConnected", handleConnect);
    });

    transport.on("connectionstatechange", (state) => {
      console.log(`Recv transport [${transport.id}] connection state: ${state}`);
    });

    recvTransportRef.current = transport;
  }, [send, waitForMessage]);

  // 消费远程音频
  const consumeRemote = useCallback(
    async (producerId: string, peerId: string) => {
      const recvTransport = recvTransportRef.current;
      const device = deviceRef.current;
      if (!recvTransport || !device) {
        console.error("Recv transport or device not ready");
        return;
      }

      send({
        type: "consume",
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      });

      const msg = await waitForMessage("consumed") as ConsumedMessage;

      try {
        const consumer = await recvTransport.consume({
          id: msg.consumerId,
          producerId: msg.producerId,
          kind: msg.kind,
          rtpParameters: msg.rtpParameters,
        });

        consumersRef.current.set(consumer.id, consumer);

        // 创建音频元素播放
        const audioElement = new Audio();
        audioElement.srcObject = new MediaStream([consumer.track]);
        audioElement.autoplay = true;
        audioElement.muted = false;
        document.body.appendChild(audioElement);

        // 显式播放，处理浏览器自动播放策略
        audioElement.play().catch((e) => {
          console.warn("Audio autoplay blocked:", e);
        });

        // 监听 track unmute 事件再次尝试播放
        consumer.track.onunmute = () => {
          audioElement.play().catch(() => {});
        };

        // 更新对等端信息
        const peer = peersRef.current.get(peerId) || { peerId };
        peer.audioConsumer = consumer;
        peer.audioElement = audioElement;
        peer.micEnabled = true;
        peersRef.current.set(peerId, peer);

        setRoomState((prev) => {
          const newPeers = new Map(prev.peers);
          newPeers.set(peerId, peer);
          return { ...prev, peers: newPeers };
        });

        // 恢复消费
        send({ type: "resumeConsuming", consumerId: consumer.id });
      } catch (err) {
        console.error("Failed to consume:", err);
      }
    },
    [send, waitForMessage]
  );

  // 音量检测
  const startSpeakingDetection = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const checkVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;
      setIsSpeaking(average > 20);
      animFrameRef.current = requestAnimationFrame(checkVolume);
    };
    checkVolume();
  }, []);

  const stopSpeakingDetection = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setIsSpeaking(false);
  }, []);

  // 延迟检测
  const startLatencyMonitoring = useCallback(() => {
    if (latencyIntervalRef.current) {
      clearInterval(latencyIntervalRef.current);
    }

    latencyIntervalRef.current = window.setInterval(async () => {
      const producer = producerRef.current;
      if (!producer) return;

      try {
        const stats = await producer.getStats();
        let rtt = 0;

        stats.forEach((report) => {
          if (report.type === "transport") {
            // 获取 transport 级别的 RTT
            rtt = report.rtt || 0;
          }
          if (report.type === "remote-inbound-rtp") {
            // 获取远端报告的 RTT
            rtt = report.roundTripTime || rtt;
          }
        });

        // 转换为毫秒
        setLatency(Math.round(rtt * 1000));
      } catch (err) {
        // 静默处理错误
      }
    }, 2000); // 每 2 秒检测一次
  }, []);

  const stopLatencyMonitoring = useCallback(() => {
    if (latencyIntervalRef.current) {
      clearInterval(latencyIntervalRef.current);
      latencyIntervalRef.current = null;
    }
    setLatency(0);
  }, []);

  // 开启麦克风（带降噪）
  const enableMic = useCallback(async () => {
    const sendTransport = sendTransportRef.current;
    if (!sendTransport) {
      console.error("Send transport not ready");
      return;
    }

    // 防重复：如果已有 producer，先关闭旧的
    if (producerRef.current) {
      console.warn("Producer already exists, closing old one before creating new");
      producerRef.current.close();
      producerRef.current = null;
    }

    try {
      // 获取音频流 - 结合浏览器原生降噪
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: noiseLevel !== "off",
          autoGainControl: true,
          sampleRate: 48000,
        },
      });

      rawStreamRef.current = rawStream;

      let processedTrack: MediaStreamTrack;

      if (noiseLevel !== "off") {
        // 使用 AudioWorklet 进行二次降噪处理
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        await audioContext.audioWorklet.addModule('/enhanced-noise-suppressor.js');

        const source = audioContext.createMediaStreamSource(rawStream);
        const noiseSuppressor = new AudioWorkletNode(audioContext, 'enhanced-noise-suppressor', {
          processorOptions: {
            gateThreshold: NOISE_PRESETS[noiseLevel].gateThreshold,
            vadThreshold: NOISE_PRESETS[noiseLevel].vadThreshold,
          }
        });
        noiseSuppressorRef.current = noiseSuppressor;

        // 监听 VAD 状态
        noiseSuppressor.port.onmessage = (event) => {
          if (event.data.type === 'vad') {
            setIsSpeaking(event.data.isSpeaking);
          }
        };

        // 创建目标节点
        const destination = audioContext.createMediaStreamDestination();

        // 连接：source -> noiseSuppressor -> destination
        source.connect(noiseSuppressor);
        noiseSuppressor.connect(destination);

        const processedStream = destination.stream;
        processedTrack = processedStream.getAudioTracks()[0];
      } else {
        processedTrack = rawStream.getAudioTracks()[0];
        startSpeakingDetection(rawStream);
      }

      const producer = await sendTransport.produce({ track: processedTrack });
      producerRef.current = producer;

      // 监听 producer 状态
      producer.on("transportclose", () => {
        console.log("Producer transport closed");
        producerRef.current = null;
        setRoomState((prev) => ({ ...prev, micEnabled: false }));
      });

      setRoomState((prev) => ({ ...prev, micEnabled: true }));

      // 开始延迟检测
      startLatencyMonitoring();
    } catch (err) {
      console.error("Failed to enable mic:", err);
    }
  }, [startSpeakingDetection, noiseLevel, startLatencyMonitoring]);

  // 关闭麦克风
  const disableMic = useCallback(() => {
    const producer = producerRef.current;
    if (producer) {
      producer.close();
      producerRef.current = null;
    }

    // 清理降噪资源
    if (noiseSuppressorRef.current) {
      noiseSuppressorRef.current.disconnect();
      noiseSuppressorRef.current = null;
    }

    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach(track => track.stop());
      rawStreamRef.current = null;
    }

    stopSpeakingDetection();
    stopLatencyMonitoring();
    setRoomState((prev) => ({ ...prev, micEnabled: false }));
  }, [stopSpeakingDetection, stopLatencyMonitoring]);

  // 加入房间
  const joinRoom = useCallback(
    async (roomId: string, peerId: string) => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      // 消息路由
      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data) as SignalingMessage;

        // 检查是否有等待的处理器
        const handler = messageHandlersRef.current.get(msg.type);
        if (handler) {
          handler(msg);
          return;
        }

        // 处理广播消息
        switch (msg.type) {
          case "newProducer":
            await consumeRemote(msg.producerId, msg.peerId);
            break;

          case "producerClosed": {
            // 其他用户关闭了麦克风
            const closedPeerId = (msg as any).peerId as string;
            const closedPeer = peersRef.current.get(closedPeerId);
            if (closedPeer) {
              closedPeer.audioConsumer?.close();
              closedPeer.audioElement?.remove();
              closedPeer.audioConsumer = undefined;
              closedPeer.audioElement = undefined;
              closedPeer.micEnabled = false;
              peersRef.current.set(closedPeerId, closedPeer);
              setRoomState((prev) => {
                const newPeers = new Map(prev.peers);
                newPeers.set(closedPeerId, { ...closedPeer });
                return { ...prev, peers: newPeers };
              });
            }
            break;
          }

          case "peerJoined": {
            const peer: PeerInfo = { peerId: msg.peerId };
            peersRef.current.set(msg.peerId, peer);
            setRoomState((prev) => {
              const newPeers = new Map(prev.peers);
              newPeers.set(msg.peerId, peer);
              return { ...prev, peers: newPeers };
            });
            break;
          }

          case "peerLeft": {
            const peer = peersRef.current.get(msg.peerId);
            if (peer) {
              peer.audioConsumer?.close();
              peer.audioElement?.remove();
              peersRef.current.delete(msg.peerId);
            }
            setRoomState((prev) => {
              const newPeers = new Map(prev.peers);
              newPeers.delete(msg.peerId);
              return { ...prev, peers: newPeers };
            });
            break;
          }

          case "error":
            console.error("Signaling error:", msg.message);
            break;
        }
      };

      return new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          send({ type: "joinRoom", roomId, peerId });
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(new Error("WebSocket connection failed"));
        };

        // 等待 joinedRoom 响应
        waitForMessage("joinedRoom").then(async (msg) => {
          const joinedMsg = msg as any;

          // 初始化 mediasoup Device
          const device = new Device();
          await device.load({
            routerRtpCapabilities: joinedMsg.rtpCapabilities,
          });
          deviceRef.current = device;

          // 初始化已有的 peers
          const initialPeers = new Map<string, PeerInfo>();
          for (const existingPeerId of joinedMsg.existingPeers || []) {
            initialPeers.set(existingPeerId, { peerId: existingPeerId });
            peersRef.current.set(existingPeerId, { peerId: existingPeerId });
          }

          setRoomState({
            roomId: joinedMsg.roomId,
            peerId: joinedMsg.peerId,
            joined: true,
            micEnabled: false,
            peers: initialPeers,
          });

          // 处理已有的 producers
          for (const p of joinedMsg.existingProducers) {
            pendingConsumesRef.current.push({
              producerId: p.producerId,
              peerId: p.peerId,
            });
          }

          // 创建 transports
          await createSendTransport();
          await createRecvTransport();

          // 消费已有的 producers
          for (const p of pendingConsumesRef.current) {
            await consumeRemote(p.producerId, p.peerId);
          }
          pendingConsumesRef.current = [];

          resolve();
        }).catch(reject);
      });
    },
    [send, waitForMessage, createSendTransport, createRecvTransport, consumeRemote]
  );

  // 离开房间
  const leaveRoom = useCallback(() => {
    // 关闭所有 consumers
    consumersRef.current.forEach((c) => c.close());
    consumersRef.current.clear();

    // 关闭 producer
    producerRef.current?.close();
    producerRef.current = null;

    // 关闭 transports
    sendTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current?.close();
    recvTransportRef.current = null;

    // 移除音频元素
    peersRef.current.forEach((p) => {
      p.audioConsumer?.close();
      p.audioElement?.remove();
    });
    peersRef.current.clear();

    // 关闭 WebSocket
    wsRef.current?.close();
    wsRef.current = null;

    deviceRef.current = null;
    messageHandlersRef.current.clear();

    setRoomState({
      roomId: "",
      peerId: "",
      joined: false,
      micEnabled: false,
      peers: new Map(),
    });
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      leaveRoom();
    };
  }, [leaveRoom]);

  return {
    roomState,
    isSpeaking,
    noiseLevel,
    latency,
    joinRoom,
    leaveRoom,
    enableMic,
    disableMic,
    setNoiseLevel,
  };
}
