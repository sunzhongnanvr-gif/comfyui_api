FROM node:20.18-slim AS builder

WORKDIR /app

# 安装构建依赖
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true && \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 安装根目录依赖 (Express API + 共享依赖)
COPY package*.json ./
ENV NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
RUN npm install

# 安装 web/ 目录依赖 (Next.js 前端)
COPY web/package.web.json ./web/package.json
RUN cd web && npm install

# 复制源码
COPY . .

# 生成 Prisma 客户端
RUN npx prisma generate

# 构建 Next.js 前端
RUN cd web && npx next build

FROM node:20.18-slim

WORKDIR /app

# 设置 apt 镜像源 (阿里)
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

# 安装 sharp 运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends libvips42 && rm -rf /var/lib/apt/lists/*

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 复制依赖和源码
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/web/node_modules ./web/node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/web ./web

EXPOSE 3001

# 启动命令
CMD ["npx", "tsx", "src/index.ts"]
