# Build
FROM node:alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

#Run
FROM node:alpine as server
WORKDIR /app
COPY package*.json .env* ./
RUN npm install --production
COPY --from=builder ./app/prod ./prod

ENV NEW_RELIC_NO_CONFIG_FILE=true

ENV NEW_RELIC_DISTRIBUTED_TRACING_ENABLED=true \
NEW_RELIC_LOG=stdout

CMD [ "npm", "run", "start" ]
