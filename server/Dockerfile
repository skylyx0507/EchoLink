# mediasoup SFU + WebSocket 信令服务器
FROM node:22-slim

WORKDIR /app

# 使用国内 Debian 镜像加速构建
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources

# 安装 mediasoup 依赖
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 配置 pip 和 npm 使用国内镜像
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
RUN npm config set registry https://registry.npmmirror.com

# 复制 package 文件
COPY package*.json ./

# 安装所有依赖（含 devDependencies 用于编译）
RUN npm ci

# 复制源代码
COPY . .

# 编译 TypeScript
RUN npm run build

# 移除 devDependencies 减小镜像体积
RUN npm prune --production

# 暴露端口
# 3000: WebSocket 信令
# 10000-10100: mediasoup WebRTC UDP 端口
EXPOSE 3000
EXPOSE 10000-10100/udp

# 启动服务
CMD ["node", "dist/index.js"]
