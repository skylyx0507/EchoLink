// 噪声抑制 AudioWorklet 处理器
// 使用噪声门限 + 动态压缩来减少背景噪音

class NoiseSuppressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.01; // 噪声底限阈值
    this.gateThreshold = 0.02; // 噪声门限阈值
    this.attackTime = 0.01; // 启动时间（秒）
    this.releaseTime = 0.1; // 释放时间（秒）
    this.gateOpen = false;
    this.gain = 1;
    this.smoothingFactor = 0.95;
    this.prevMagnitude = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'params') {
        this.noiseFloor = event.data.noiseFloor || this.noiseFloor;
        this.gateThreshold = event.data.gateThreshold || this.gateThreshold;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    for (let channel = 0; channel < input.length; channel++) {
      const inputData = input[channel];
      const outputData = output[channel];

      // 计算 RMS 能量
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      // 平滑处理
      const smoothedRms = this.smoothingFactor * this.prevMagnitude +
                          (1 - this.smoothingFactor) * rms;
      this.prevMagnitude = smoothedRms;

      // 噪声门限逻辑
      if (smoothedRms > this.gateThreshold) {
        // 信号超过阈值，开门
        if (!this.gateOpen) {
          this.gateOpen = true;
        }
        this.gain = Math.min(1, this.gain + 0.1);
      } else if (smoothedRms < this.noiseFloor) {
        // 信号低于噪声底限，关门
        this.gateOpen = false;
        this.gain = Math.max(0, this.gain - 0.05);
      }

      // 应用增益
      for (let i = 0; i < inputData.length; i++) {
        // 软限幅：避免突然的增益变化
        outputData[i] = inputData[i] * this.gain;
      }
    }

    return true;
  }
}

registerProcessor('noise-suppressor', NoiseSuppressorProcessor);
