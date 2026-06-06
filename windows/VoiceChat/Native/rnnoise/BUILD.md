# RNNoise Windows DLL 编译与分发指南

> 本文档说明如何将 RNNoise 编译为 Windows DLL，并集成到 EchoLink 中。
> **核心原则：开发者编译一次，最终用户零编译。**

---

## 分发架构

```
┌─────────────────────────────────────────────────────────────┐
│  开发者（有 Visual Studio / MSYS2）                          │
│  ├── 编译 RNNoise → librnnoise.dll                          │
│  └── 将 DLL 放入 windows/VoiceChat/lib/                     │
│       └── 提交到 Git 仓库（可选）                            │
├─────────────────────────────────────────────────────────────┤
│  最终用户（只装 .NET 8 Runtime）                             │
│  ├── git clone / 下载 Release ZIP                           │
│  ├── dotnet build（自动复制 lib/librnnoise.dll）            │
│  └── 运行 VoiceChat.exe（DLL 已就绪）                       │
└─────────────────────────────────────────────────────────────┘
```

**`.csproj` 已配置**：如果 `lib/librnnoise.dll` 存在，自动复制到输出目录。如果不存在，项目仍可编译运行，只是降噪功能回退到 Phase 1（噪声门限）。

---

## 前提条件（仅开发者需要）

以下任一环境均可：

### 方案 A：Visual Studio 2022（推荐）
- 安装 **"使用 C++ 的桌面开发"** 工作负载
- 安装 **CMake 组件**（或单独安装 CMake 3.16+）

### 方案 B：MSYS2 / MinGW
- 安装 [MSYS2](https://www.msys2.org/)
- 安装 MinGW-w64 工具链：`pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-cmake`

---

## 源码位置

RNNoise 源码已包含在项目中：

```
windows/VoiceChat/Native/rnnoise/
├── CMakeLists.txt          # 简化的 CMake 配置（不依赖 autotools）
├── BUILD.md                # 本文档
├── include/
│   └── rnnoise.h           # 公共 API 头文件
└── src/
    ├── celt_lpc.c/h
    ├── denoise.c/h         # 核心降噪逻辑
    ├── kiss_fft.c/h        # FFT 实现
    ├── nnet.c/h            # 神经网络推理
    ├── nnet_arch.h
    ├── nnet_default.c      # 默认模型（权重嵌入代码）
    ├── pitch.c/h           # 基频检测
    ├── rnn.c/h             # RNN 层实现
    ├── rnnoise_tables.c    # 查找表
    └── ...                 # 其他辅助文件
```

---

## 编译步骤（开发者执行一次）

### 方案 A：Visual Studio 2022 + CMake

```powershell
# 1. 打开 "x64 Native Tools Command Prompt for VS 2022"
#    (开始菜单 → Visual Studio 2022 → x64 Native Tools)

# 2. 进入 RNNoise 目录
cd windows\VoiceChat\Native\rnnoise

# 3. 创建构建目录
mkdir build
cd build

# 4. 生成 VS 项目
cmake .. -A x64

# 5. 编译
cmake --build . --config Release

# 6. 将 DLL 放入 lib/ 目录（项目已配置自动引用）
copy build\Release\librnnoise.dll ..\..\..\lib\
```

### 方案 B：MSYS2 / MinGW

```bash
# 1. 打开 MSYS2 MinGW 64-bit 终端

# 2. 进入 RNNoise 目录
cd /c/path/to/EchoLink/windows/VoiceChat/Native/rnnoise

# 3. 创建构建目录
mkdir build
cd build

# 4. 生成 Makefile
cmake .. -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release

# 5. 编译
mingw32-make -j$(nproc)

# 6. 将 DLL 放入 lib/ 目录
cp librnnoise.dll ../../../lib/
```

### 方案 C：Visual Studio 直接打开（无需命令行）

1. 打开 Visual Studio 2022
2. 选择 **"打开本地文件夹"**
3. 选择 `windows/VoiceChat/Native/rnnoise`
4. VS 会自动识别 CMakeLists.txt
5. 选择 **Release / x64** 配置
6. 点击 **生成 → 生成全部**
7. 将 `build/Release/librnnoise.dll` 复制到 `windows/VoiceChat/lib/`

---

## 部署 DLL（一次操作，所有用户受益）

编译成功后，只需将 `librnnoise.dll` 放到固定位置：

```
windows/VoiceChat/lib/librnnoise.dll
```

**`.csproj` 自动复制配置**：
```xml
<None Include="lib\librnnoise.dll" Condition="Exists('lib\librnnoise.dll')">
  <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
  <TargetPath>librnnoise.dll</TargetPath>
</None>
```

**行为说明**：
- ✅ DLL 存在 → `dotnet build` 自动复制到输出目录，中/高档位启用 AI 降噪
- ⚠️ DLL 不存在 → 项目仍可正常编译运行，中/高档位自动回退到 Phase 1 噪声门限

**建议**：将 `lib/librnnoise.dll` 提交到 Git 仓库，这样所有克隆仓库的开发者/用户都无需再编译。

---

## 验证编译成功

编译完成后，检查导出符号：

```powershell
# 使用 VS 自带的 dumpbin
dumpbin /exports build\Release\librnnoise.dll

# 应看到以下导出函数：
# rnnoise_create
# rnnoise_destroy
# rnnoise_process_frame
# rnnoise_get_frame_size
# rnnoise_init
# rnnoise_model_from_file
# ...
```

---

## 常见问题

### Q1: 最终用户需要安装 Visual Studio 吗？
**答：不需要。** 开发者编译好 DLL 并放入 `lib/` 目录后，最终用户只需安装 [.NET 8 Runtime](https://dotnet.microsoft.com/download/dotnet/8.0)，即可直接运行 `dotnet build` 或执行预编译的 `VoiceChat.exe`。

### Q2: DLL 可以随 Release 一起分发吗？
**答：可以。** 发布 Release 时，`lib/librnnoise.dll` 会通过 `.csproj` 自动打包到输出目录。最终 ZIP/Installer 中已包含 DLL，用户开箱即用。

### Q3: CMake 报错 "No CMAKE_C_COMPILER could be found"
**原因**：未安装 C 编译器或环境变量未配置。
**解决**：确保安装了 Visual Studio 的 "使用 C++ 的桌面开发" 工作负载，或 MSYS2 的 `mingw-w64-x86_64-gcc`。

### Q4: 编译报错 "undefined reference to sqrtf"
**原因**：Windows 上数学库链接问题。
**解决**：`CMakeLists.txt` 已处理：`if(NOT WIN32) target_link_libraries(rnnoise m) endif()`。如仍报错，在 Windows 上不需要链接 `m`。

### Q5: DLL 加载失败（DllNotFoundException）
**原因**：C# 找不到 `librnnoise.dll`。
**解决**：
1. 确认 DLL 文件名是 `librnnoise.dll`（不是 `rnnoise.dll`）
2. 确认 DLL 在输出目录（与 `VoiceChat.exe` 同级）
3. 确认是 x64 架构（与 .NET 8 一致）
4. 使用 [Dependencies](https://github.com/lucasg/Dependencies) 工具检查 DLL 依赖是否齐全

### Q6: 运行时崩溃 "BadImageFormatException"
**原因**：DLL 架构与 .NET 运行时不匹配（x86 vs x64）。
**解决**：重新用 x64 编译 DLL。

---

## 技术细节

### 为什么不用 autotools？

RNNoise 官方使用 `./autogen.sh && ./configure && make`，但这在 Windows 上需要 MSYS2 + 完整 autotools 链。我们提供的 `CMakeLists.txt` 是**简化版**，直接列出源文件编译，不依赖 `config.h` 生成。

### 默认模型

`nnet_default.c` 中嵌入了默认模型的权重（约 85KB）。编译后这些权重直接链接到 DLL 中，无需外部模型文件。

### 导出的 API

| 函数 | 说明 |
|------|------|
| `rnnoise_create(model)` | 创建降噪状态（model=NULL 用默认模型） |
| `rnnoise_destroy(st)` | 释放降噪状态 |
| `rnnoise_process_frame(st, out, in)` | 处理一帧（480 采样点） |
| `rnnoise_get_frame_size()` | 获取帧大小（应返回 480） |

---

*文档结束。编译问题请检查 Visual Studio / MSYS2 安装完整性。*
