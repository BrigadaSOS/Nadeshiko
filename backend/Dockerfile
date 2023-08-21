# Build
FROM node:20.5.1-bullseye AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y nscd

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

#Run
FROM node:20.5.1-bullseye AS server
WORKDIR /app
COPY package*.json .env* ./
RUN npm install --production
COPY --from=builder ./app/prod ./prod

ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV NEW_RELIC_LOG=stdout

CMD [ "npm", "run", "start" ]
