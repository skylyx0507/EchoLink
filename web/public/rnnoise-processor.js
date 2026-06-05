// RNNoise 降噪 AudioWorklet 处理器
// 使用深度学习模型进行噪声抑制

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rnnoise = null;
    this.state = null;
    this.bufferSize = 480; // RNNoise 需要 480 采样点（10ms @ 48kHz）
    this.inputBuffer = new Float32Array(this.bufferSize);
    this.outputBuffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isInitialized = false;

    this.port.onmessage = (event) => {
      if (event.data.type === 'init') {
        this.initRNNoise(event.data.wasmBinary);
      } else if (event.data.type === 'destroy') {
        this.destroy();
      }
    };
  }

  async initRNNoise(wasmBinary) {
    try {
      // 动态加载 RNNoise WASM 模块
      const module = await WebAssembly.instantiate(wasmBinary, {
        env: {
          memory: new WebAssembly.Memory({ initial: 256 }),
          abort: () => { throw new Error('abort'); }
        }
      });

      // 获取 WASM 导出函数
      const exports = module.instance.exports;
      this.rnnoise = {
        create: exports.rnnoise_create,
        destroy: exports.rnnoise_destroy,
        processFrame: exports.rnnoise_process_frame,
        getStateSize: exports.rnnoise_get_size,
        malloc: exports.malloc,
        free: exports.free,
        memory: exports.memory
      };

      // 创建 RNNoise 状态
      const stateSize = this.rnnoise.getStateSize();
      const statePtr = this.rnnoise.malloc(stateSize);
      this.state = this.rnnoise.create(statePtr);

      // 分配输入输出缓冲区
      this.inputPtr = this.rnnoise.malloc(this.bufferSize * 4); // float32 = 4 bytes
      this.outputPtr = this.rnnoise.malloc(this.bufferSize * 4);

      this.isInitialized = true;
      this.port.postMessage({ type: 'initialized' });
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error.message });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0] || !this.isInitialized) {
      // 如果未初始化，直接透传
      if (input && input[0] && output && output[0]) {
        for (let i = 0; i < input[0].length; i++) {
          output[0][i] = input[0][i];
        }
      }
      return true;
    }

    const inputData = input[0];
    const outputData = output[0];

    for (let i = 0; i < inputData.length; i++) {
      this.inputBuffer[this.bufferIndex] = inputData[i];
      this.bufferIndex++;

      if (this.bufferIndex >= this.bufferSize) {
        // 处理一帧（480 采样点）
        this.processFrame();
        this.bufferIndex = 0;
      }

      // 输出处理后的样本
      outputData[i] = this.outputBuffer[this.bufferIndex];
    }

    return true;
  }

  processFrame() {
    if (!this.rnnoise || !this.state) return;

    // 将输入数据复制到 WASM 内存
    const inputView = new Float32Array(
      this.rnnoise.memory.buffer,
      this.inputPtr,
      this.bufferSize
    );
    inputView.set(this.inputBuffer);

    // 调用 RNNoise 处理
    const vadProb = this.rnnoise.processFrame(
      this.state,
      this.outputPtr,
      this.inputPtr
    );

    // 从 WASM 内存读取输出
    const outputView = new Float32Array(
      this.rnnoise.memory.buffer,
      this.outputPtr,
      this.bufferSize
    );
    this.outputBuffer.set(outputView);

    // 发送 VAD 概率（用于语音活动检测）
    this.port.postMessage({ type: 'vad', probability: vadProb });
  }

  destroy() {
    if (this.rnnoise && this.state) {
      this.rnnoise.destroy(this.state);
      this.rnnoise.free(this.inputPtr);
      this.rnnoise.free(this.outputPtr);
      this.rnnoise.free(this.state);
      this.state = null;
    }
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
