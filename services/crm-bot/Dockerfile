FROM node:24-bookworm-slim
WORKDIR /opt/avtocena
COPY --chown=node:node . .
RUN npm ci --ignore-scripts && npm cache clean --force
USER node
ENV NODE_ENV=production JSON_STORAGE_DRIVER=object
CMD ["node", "--import", "tsx", "scripts/crm-bot-service.ts"]
