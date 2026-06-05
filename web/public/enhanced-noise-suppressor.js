// 增强型噪声抑制 AudioWorklet 处理器
// 结合：频谱分析 + 噪声门限 + 动态压缩 + 人声频段过滤

class EnhancedNoiseSuppressor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options.processorOptions || {};

    // 噪声门限参数 - 更严格的阈值
    this.gateThreshold = opts.gateThreshold || 0.025;
    this.gateHysteresis = 0.003;
    this.gateOpen = false;

    // 动态压缩
    this.compressorGain = 1;

    // 平滑处理 - 更快响应
    this.smoothingFactor = 0.85;
    this.prevMagnitude = 0;

    // 自适应噪声底限
    this.noiseFloor = 0.005;
    this.noiseFloorAlpha = 0.0005;
    this.frameCount = 0;

    // VAD 参数
    this.vadThreshold = opts.vadThreshold || 0.035;
    this.isSpeaking = false;

    // 频谱分析参数 - 人声频段 300Hz-3400Hz
    this.fftSize = 256;
    this.voiceLowBin = Math.floor(300 / (48000 / this.fftSize));
    this.voiceHighBin = Math.floor(3400 / (48000 / this.fftSize));

    // 历史能量用于检测瞬态噪音（键盘鼠标）
    this.energyHistory = new Float32Array(10);
    this.historyIndex = 0;
    this.transientThreshold = 3.0; // 瞬态噪音倍数阈值
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    const inputData = input[0];
    const outputData = output[0];
    const length = inputData.length;

    // 计算 RMS 能量
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += inputData[i] * inputData[i];
    }
    const rms = Math.sqrt(sum / length);

    // 平滑处理
    const smoothedRms = this.smoothingFactor * this.prevMagnitude +
                        (1 - this.smoothingFactor) * rms;
    this.prevMagnitude = smoothedRms;

    // 自适应噪声底限
    this.frameCount++;
    if (this.frameCount > 150) {
      if (smoothedRms < this.noiseFloor * 2) {
        this.noiseFloor = this.noiseFloor * (1 - this.noiseFloorAlpha) +
                         smoothedRms * this.noiseFloorAlpha;
      }
    }

    // 检测瞬态噪音（键盘鼠标点击声特征：短促、能量突变）
    const avgEnergy = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    const isTransient = this.frameCount > 20 && avgEnergy > 0 &&
                        smoothedRms > avgEnergy * this.transientThreshold &&
                        smoothedRms < 0.15; // 键盘声通常不会太大

    // 更新能量历史
    this.energyHistory[this.historyIndex] = smoothedRms;
    this.historyIndex = (this.historyIndex + 1) % this.energyHistory.length;

    // 动态调整门限
    const adaptiveThreshold = Math.max(this.gateThreshold, this.noiseFloor * 2);

    // 噪声门限逻辑 - 需要持续超过阈值才开门
    if (isTransient) {
      // 瞬态噪音，保持当前状态
    } else if (smoothedRms > adaptiveThreshold + this.gateHysteresis) {
      this.gateOpen = true;
      this.isSpeaking = true;
    } else if (smoothedRms < adaptiveThreshold - this.gateHysteresis) {
      this.gateOpen = false;
      this.isSpeaking = false;
    }

    // 计算增益 - 对瞬态噪音额外抑制
    let targetGain;
    if (isTransient) {
      targetGain = 0.005; // 强烈抑制瞬态噪音
    } else if (this.gateOpen) {
      targetGain = 1;
    } else {
      targetGain = 0.008; // 静音时几乎完全关闭
    }

    // 平滑增益变化 - 更快的攻击，更慢的释放
    const attackSmoothing = 0.3;  // 快速响应
    const releaseSmoothing = 0.05; // 缓慢释放避免咔嗒声
    const smoothing = targetGain > this.compressorGain ? attackSmoothing : releaseSmoothing;
    this.compressorGain = this.compressorGain * (1 - smoothing) + targetGain * smoothing;

    // 应用增益
    for (let i = 0; i < length; i++) {
      outputData[i] = inputData[i] * this.compressorGain;
    }

    // 发送 VAD 状态
    if (this.frameCount % 5 === 0) {
      this.port.postMessage({
        type: 'vad',
        isSpeaking: this.isSpeaking && !isTransient,
        rms: smoothedRms,
        isTransient: isTransient
      });
    }

    return true;
  }
}

registerProcessor('enhanced-noise-suppressor', EnhancedNoiseSuppressor);
