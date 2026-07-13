FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV OPENTREE_DATA_DIR=/data
ENV PORT=8080

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package*.json ./

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server/index.mjs"]
