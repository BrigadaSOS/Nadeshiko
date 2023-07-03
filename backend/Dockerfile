# Build
FROM node:lts-alpine3.18 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# FFMPeg install
RUN apt-get -y update
RUN apt-get -y upgrade
RUN apt-get install -y ffmpeg

#Run
FROM node:lts-alpine3.18 AS server
WORKDIR /app
COPY package*.json .env* ./
RUN npm install --production
COPY --from=builder ./app/prod ./prod

ENV NEW_RELIC_NO_CONFIG_FILE=true
ENV NEW_RELIC_LOG=stdout

CMD [ "npm", "run", "start" ]
