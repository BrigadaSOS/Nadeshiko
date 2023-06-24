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
COPY package*.json ./
RUN npm install --production
COPY --from=builder ./app/prod ./prod

CMD [ "npm", "run", "start" ]
