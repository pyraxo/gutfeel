FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server.mjs ./
COPY --chown=node:node server ./server
COPY --chown=node:node web/public ./web/public

USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '4173') + '/health').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
