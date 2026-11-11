FROM node:24.22.1-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY apps/bot/package*.json ./apps/bot/
COPY packages/engine/package*.json ./packages/engine/
COPY packages/ui/package*.json ./packages/ui/
RUN npm ci

FROM node:24.22.1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/check-runtime-streams.mjs
RUN npm run build
# Historical reference inputs are archived to object storage before activation.
# Keep compiled runtime dictionaries and the small master model directory.
RUN node -e "const fs=require('fs');for(const root of ['data','apps/web/.next/standalone/data'])for(const name of ['denominator','generated'])fs.rmSync(root+'/catalog/knowledge-source-snapshots/'+name,{recursive:true,force:true})"

FROM node:24.22.1-alpine AS runner
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/data ./data
COPY --from=builder /app/scripts/check-runtime-streams.mjs /tmp/check-runtime-streams.mjs
RUN node /tmp/check-runtime-streams.mjs && rm /tmp/check-runtime-streams.mjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
