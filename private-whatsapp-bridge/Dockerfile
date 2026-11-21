FROM node:22-bookworm-slim
WORKDIR /srv/private-whatsapp
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs ./
ENV NODE_ENV=production PORT=3081 SESSION_DIR=/data/wa-sessions
VOLUME ["/data/wa-sessions"]
EXPOSE 3081
CMD ["node","server.mjs"]
