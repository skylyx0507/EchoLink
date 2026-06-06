# mediasoup SFU + WebSocket 信令服务器
FROM node:20-slim

WORKDIR /app

# 安装 mediasoup 依赖
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制 package 文件
COPY package*.json ./

# 复制源代码
COPY . .

# 安装所有依赖（含 devDependencies 用于编译）
RUN npm ci

# 编译 TypeScript
RUN npm run build

# 移除 devDependencies 减小镜像体积
RUN npm prune --production

# 暴露端口
# 1985: WebSocket 信令
# 10000-10100: mediasoup WebRTC UDP 端口
EXPOSE 1985
EXPOSE 10000-10100/udp

# 启动服务
CMD ["node", "dist/index.js"]
