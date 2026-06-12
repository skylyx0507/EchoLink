import { useEffect, useRef, useState, useCallback } from "react";
import { Device } from "mediasoup-client";
import { types } from "mediasoup-client";

// Augment HTMLAudioElement for setSinkId which is not in all DOM type definitions.
declare global {
  interface HTMLAudioElement {
    setSinkId?(sinkId: string): Promise<void>;
  }
}
import type {
  SignalingMessage,
  PeerInfo,
  RoomState,
  TransportCreatedMessage,
  ConsumedMessage,
  JoinedRoomMessage,
  AuthenticatedMessage,
} from "../types";

// 降噪档位配置
export type NoiseLevel = "off" | "low" | "medium" | "high";

export const NOISE_PRESETS: Record<NoiseLevel, { label: string; gateThreshold: number; vadThreshold: number }> = {
  off: { label: "关闭", gateThreshold: 0, vadThreshold: 0.025 },
  low: { label: "低", gateThreshold: 0.01, vadThreshold: 0.02 },
  medium: { label: "中", gateThreshold: 0.02, vadThreshold: 0.03 },
  high: { label: "高", gateThreshold: 0.04, vadThreshold: 0.05 },
};

export interface AudioDevice {
  deviceId: string;
  label: string;
}

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
  const [micDevices, setMicDevices] = useState<AudioDevice[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<AudioDevice[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>(
    () => localStorage.getItem("echolink-mic") || ""
  );
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>(
    () => localStorage.getItem("echolink-speaker") || ""
  );

  const wsRef = useRef<WebSocket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<types.Transport | null>(null);
  const recvTransportRef = useRef<types.Transport | null>(null);
  const producersRef = useRef<Map<string, types.Producer>>(new Map());
  const activeProducerIdRef = useRef<string | null>(null);
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

  // 检测浏览器是否支持 setSinkId
  const supportsSetSinkId = typeof HTMLAudioElement !== 'undefined' &&
    'setSinkId' in HTMLAudioElement.prototype;

  // 持久化设备选择
  useEffect(() => {
    if (selectedMic) localStorage.setItem("echolink-mic", selectedMic);
  }, [selectedMic]);
  useEffect(() => {
    if (selectedSpeaker) localStorage.setItem("echolink-speaker", selectedSpeaker);
  }, [selectedSpeaker]);

  // 发送信令消息
  const send = useCallback((msg: SignalingMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // 等待特定类型的消息（带超时）
  const waitForMessage = useCallback((type: string, timeoutMs = 15000): Promise<SignalingMessage> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        messageHandlersRef.current.delete(type);
        reject(new Error(`等待 ${type} 超时`));
      }, timeoutMs);

      const handler = (msg: SignalingMessage) => {
        if (msg.type === "error") {
          // 忽略不相关的错误消息，让超时处理
          console.warn(`waitForMessage(${type}): ignoring error: ${msg.message}`);
          return;
        }
        clearTimeout(timer);
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
          messageHandlersRef.current.delete("transportConnected");
          callback();
        } else if (m.type === "error" && m.transportId === transport.id) {
          messageHandlersRef.current.delete("transportConnected");
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
            messageHandlersRef.current.delete("produced");
            callback({ id: m.producerId });
          } else if (m.type === "error") {
            messageHandlersRef.current.delete("produced");
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
          messageHandlersRef.current.delete("transportConnected");
          callback();
        } else if (m.type === "error" && m.transportId === transport.id) {
          messageHandlersRef.current.delete("transportConnected");
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

        console.log(`Consumer created: ${consumer.id} for peer ${peerId}, track readyState: ${consumer.track.readyState}, muted: ${consumer.track.muted}`);

        // 创建音频元素播放
        const audioElement = new Audio();
        audioElement.srcObject = new MediaStream([consumer.track]);
        audioElement.autoplay = true;
        audioElement.muted = false;
        audioElement.volume = 1.0;
        document.body.appendChild(audioElement);

        // 应用选中的扬声器设备
        if (selectedSpeaker && typeof audioElement.setSinkId === "function") {
          audioElement.setSinkId(selectedSpeaker).catch(() => {});
        }

        // 显式播放，处理浏览器自动播放策略
        audioElement.play().catch((e) => {
          console.warn("Audio autoplay blocked:", e);
        });

        // 监听 track 状态变化
        consumer.track.onmute = () => {
          console.log(`Consumer track muted: ${consumer.id} for peer ${peerId}`);
        };
        consumer.track.onunmute = () => {
          console.log(`Consumer track unmuted: ${consumer.id} for peer ${peerId}, playing audio`);
          audioElement.play().catch((e) => {
            console.warn("Audio play failed on unmute:", e);
          });
        };
        consumer.track.onended = () => {
          console.log(`Consumer track ended: ${consumer.id} for peer ${peerId}`);
        };

        // 监听 consumer 状态
        consumer.on("transportclose", () => {
          console.log(`Consumer transport closed: ${consumer.id}`);
        });

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
        console.log(`Resume consuming sent for consumer: ${consumer.id}`);
      } catch (err) {
        console.error("Failed to consume:", err);
      }
    },
    [send, waitForMessage, selectedSpeaker]
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
      let maxRtt = 0;
      let hasStats = false;

      for (const producer of producersRef.current.values()) {
        try {
          const stats = await producer.getStats();
          stats.forEach((report) => {
            if (report.type === "transport") {
              maxRtt = Math.max(maxRtt, report.rtt || 0);
            }
            if (report.type === "remote-inbound-rtp") {
              maxRtt = Math.max(maxRtt, report.roundTripTime || 0);
            }
          });
          hasStats = true;
        } catch {
          // 静默处理单个 producer 的错误
        }
      }

      if (hasStats) {
        setLatency(Math.round(maxRtt * 1000));
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

  // 枚举音频设备
  const enumerateAudioDevices = useCallback(async () => {
    try {
      // 请求临时权限以获取设备标签
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());

      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics: AudioDevice[] = [];
      const speakers: AudioDevice[] = [];
      for (const d of devices) {
        if (d.deviceId === "continue") continue;
        if (d.kind === "audioinput") {
          mics.push({ deviceId: d.deviceId, label: d.label || `麦克风 ${mics.length + 1}` });
        } else if (d.kind === "audiooutput") {
          speakers.push({ deviceId: d.deviceId, label: d.label || `扬声器 ${speakers.length + 1}` });
        }
      }
      setMicDevices(mics);
      setSpeakerDevices(speakers);
      // 恢复保存的设备选择，或默认选中第一个
      const savedMic = localStorage.getItem("echolink-mic");
      const savedSpeaker = localStorage.getItem("echolink-speaker");
      if (mics.length > 0) {
        const micId = (savedMic && mics.some(d => d.deviceId === savedMic)) ? savedMic : mics[0].deviceId;
        setSelectedMic(micId);
      }
      if (speakers.length > 0) {
        const spkId = (savedSpeaker && speakers.some(d => d.deviceId === savedSpeaker)) ? savedSpeaker : speakers[0].deviceId;
        setSelectedSpeaker(spkId);
      }
    } catch (err) {
      console.error("Failed to enumerate audio devices:", err);
    }
  }, []);

  // 切换扬声器时，更新已有音频元素的输出设备
  const applySpeakerToAudioElements = useCallback((deviceId: string) => {
    peersRef.current.forEach((peer) => {
      if (peer.audioElement && typeof peer.audioElement.setSinkId === "function") {
        peer.audioElement.setSinkId(deviceId).catch(() => {});
      }
    });
  }, []);

  // 开启麦克风（带降噪）
  const enableMic = useCallback(async (): Promise<string | null> => {
    const sendTransport = sendTransportRef.current;
    if (!sendTransport) {
      console.error("Send transport not ready");
      return null;
    }

    // 防重复：如果已有 active producer，先关闭旧的
    const activeId = activeProducerIdRef.current;
    if (activeId && producersRef.current.has(activeId)) {
      console.warn("Producer already exists, closing old one before creating new");
      const oldProducer = producersRef.current.get(activeId)!;
      oldProducer.close();
      producersRef.current.delete(activeId);
      activeProducerIdRef.current = null;
    }

    try {
      // 获取音频流 - 使用选中的麦克风设备
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: noiseLevel !== "off",
        autoGainControl: true,
        sampleRate: 48000,
      };
      if (selectedMic) {
        audioConstraints.deviceId = { exact: selectedMic };
      }
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
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
      const producerId = producer.id;
      producersRef.current.set(producerId, producer);
      activeProducerIdRef.current = producerId;

      // 监听 producer 状态
      producer.on("transportclose", () => {
        console.log("Producer transport closed");
        producersRef.current.delete(producerId);
        if (activeProducerIdRef.current === producerId) {
          activeProducerIdRef.current = null;
        }
        setRoomState((prev) => ({ ...prev, micEnabled: producersRef.current.size > 0 }));
      });

      setRoomState((prev) => ({ ...prev, micEnabled: true }));

      // 开始延迟检测
      startLatencyMonitoring();

      return producerId;
    } catch (err) {
      console.error("Failed to enable mic:", err);
      return null;
    }
  }, [startSpeakingDetection, noiseLevel, startLatencyMonitoring, selectedMic]);

  // 关闭麦克风
  const disableMic = useCallback((targetProducerId?: string) => {
    if (targetProducerId) {
      // 关闭指定 Producer
      const producer = producersRef.current.get(targetProducerId);
      if (producer) {
        producer.close();
        producersRef.current.delete(targetProducerId);
      }
      if (activeProducerIdRef.current === targetProducerId) {
        activeProducerIdRef.current = null;
      }
    } else {
      // 关闭所有 Producer
      producersRef.current.forEach((producer) => producer.close());
      producersRef.current.clear();
      activeProducerIdRef.current = null;
    }

    // 清理降噪资源（仅当没有活跃 Producer 时）
    if (producersRef.current.size === 0) {
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
    }

    setRoomState((prev) => ({ ...prev, micEnabled: producersRef.current.size > 0 }));
  }, [stopSpeakingDetection, stopLatencyMonitoring]);

  // 加入房间
  const joinRoom = useCallback(
    async (serverUrl: string, roomId: string, peerId: string, token?: string | null) => {
      const ws = new WebSocket(serverUrl);
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

        // 错误消息：投递给所有 pending handler（不自动删除）
        // waitForMessage 的 handler 忽略错误后继续等待正常响应
        // transportConnected/produced 的 handler 处理错误后自行清理
        if (msg.type === "error") {
          for (const h of messageHandlersRef.current.values()) {
            h(msg);
          }
          return;
        }

        // 处理广播消息
        switch (msg.type) {
          case "newProducer":
            await consumeRemote(msg.producerId, msg.peerId);
            break;

          case "producerClosed": {
            // 其他用户关闭了麦克风
            const closedPeerId = msg.peerId;
            const closedPeer = peersRef.current.get(closedPeerId);
            if (closedPeer) {
              closedPeer.audioConsumer?.close();
              if (closedPeer.audioElement) {
                closedPeer.audioElement.pause();
                closedPeer.audioElement.srcObject = null;
                closedPeer.audioElement.remove();
              }
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
            console.log("[peerJoined] peer:", msg.peerId);
            const peer: PeerInfo = { peerId: msg.peerId };
            peersRef.current.set(msg.peerId, peer);
            setRoomState((prev) => {
              const newPeers = new Map(prev.peers);
              newPeers.set(msg.peerId, peer);
              console.log("[peerJoined] updated peers:", Array.from(newPeers.keys()));
              return { ...prev, peers: newPeers };
            });
            break;
          }

          case "peerLeft": {
            const peer = peersRef.current.get(msg.peerId);
            if (peer) {
              peer.audioConsumer?.close();
              if (peer.audioElement) {
                peer.audioElement.pause();
                peer.audioElement.srcObject = null;
                peer.audioElement.remove();
              }
              peersRef.current.delete(msg.peerId);
            }
            setRoomState((prev) => {
              const newPeers = new Map(prev.peers);
              newPeers.delete(msg.peerId);
              return { ...prev, peers: newPeers };
            });
            break;
          }

        }
      };

      return new Promise<void>((resolve, reject) => {
        ws.onopen = async () => {
          console.log("[joinRoom] WebSocket opened");

          // If a token is provided, authenticate before joining the room.
          if (token) {
            try {
              send({ type: "authenticate", token });
              const authMsg = (await waitForMessage("authenticated")) as AuthenticatedMessage;
              console.log("[joinRoom] authenticated as", authMsg.username);
            } catch (err) {
              console.error("[joinRoom] authentication failed:", err);
              reject(new Error("Authentication failed"));
              ws.close();
              return;
            }
          }

          console.log("[joinRoom] sending joinRoom");
          send({ type: "joinRoom", roomId, peerId });
          console.log("[joinRoom] joinRoom message sent");
        };

        ws.onerror = (error) => {
          console.error("[joinRoom] WebSocket error:", error);
          reject(new Error("WebSocket connection failed"));
        };

        ws.onclose = (event) => {
          console.log(`[joinRoom] WebSocket closed: code=${event.code}, reason=${event.reason}`);
        };

        // 等待 joinedRoom 响应
        waitForMessage("joinedRoom").then(async (msg) => {
          const joinedMsg = msg as JoinedRoomMessage;
          console.log("[joinRoom] received joinedRoom:", {
            roomId: joinedMsg.roomId,
            existingPeers: joinedMsg.existingPeers,
            existingProducers: joinedMsg.existingProducers,
          });

          // 初始化 mediasoup Device
          const device = new Device();
          await device.load({
            routerRtpCapabilities: joinedMsg.rtpCapabilities,
          });
          deviceRef.current = device;

          // 初始化已有的 peers
          const initialPeers = new Map<string, PeerInfo>();
          for (const existingPeerId of joinedMsg.existingPeers) {
            initialPeers.set(existingPeerId, { peerId: existingPeerId });
            peersRef.current.set(existingPeerId, { peerId: existingPeerId });
          }
          console.log("[joinRoom] initialPeers:", Array.from(initialPeers.keys()));

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

          // 枚举音频设备
          enumerateAudioDevices();

          resolve();
        }).catch(reject);
      });
    },
    [send, waitForMessage, createSendTransport, createRecvTransport, consumeRemote, enumerateAudioDevices]
  );

  // 离开房间
  const leaveRoom = useCallback(() => {
    // 关闭所有 consumers
    consumersRef.current.forEach((c) => c.close());
    consumersRef.current.clear();

    // 关闭所有 producers
    producersRef.current.forEach((p) => p.close());
    producersRef.current.clear();
    activeProducerIdRef.current = null;

    // 关闭 transports
    sendTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current?.close();
    recvTransportRef.current = null;

    // 移除音频元素
    peersRef.current.forEach((p) => {
      p.audioConsumer?.close();
      if (p.audioElement) {
        p.audioElement.pause();
        p.audioElement.srcObject = null;
        p.audioElement.remove();
      }
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
    micDevices,
    speakerDevices,
    selectedMic,
    selectedSpeaker,
    setSelectedMic,
    setSelectedSpeaker: (id: string) => {
      setSelectedSpeaker(id);
      applySpeakerToAudioElements(id);
    },
    enumerateAudioDevices,
    supportsSetSinkId,
  };
}
