FROM node:22-alpine AS base

WORKDIR /app

COPY app/package.json app/package-lock.json* ./
RUN npm install

COPY app/ ./
COPY assets ./assets
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
