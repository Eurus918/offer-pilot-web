# 可选：想跑在容器里时用。
# 注意：默认不挂载卷的话，数据只存在于容器内部，删容器即丢。
# 持久化用法见文件末尾注释。
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# 首次启动会从模板生成 agent-kb/ 和 data/store.json
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]

# 构建：
#   docker build -t offer-pilot .
# 运行（数据仅存容器内）：
#   docker run -p 3000:3000 -e DEEPSEEK_API_KEY=sk-xxx offer-pilot
# 运行（数据持久化到本机 ./data 和 ./agent-kb）：
#   docker run -p 3000:3000 \
#     -e DEEPSEEK_API_KEY=sk-xxx \
#     -v "$PWD/data:/app/data" \
#     -v "$PWD/agent-kb:/app/agent-kb" \
#     offer-pilot
