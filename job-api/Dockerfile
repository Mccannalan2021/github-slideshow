# Alberta Jobs API. No dependencies to install: it only needs Node.
FROM node:22-alpine
WORKDIR /app
COPY package.json config.json pull-plan.json ./
COPY src ./src
COPY scripts ./scripts
COPY sources ./sources
COPY client ./client
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
# Your resume, piles, applications and sent emails live here: mount a volume so they survive restarts.
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/server.js"]
