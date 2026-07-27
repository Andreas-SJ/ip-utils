FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN apk add --no-cache iputils iproute2
COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN mkdir -p data/plans
EXPOSE 80
CMD ["node", "prod-server.mjs"]
