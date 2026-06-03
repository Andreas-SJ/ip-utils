FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
RUN apk add --no-cache iputils iproute2
COPY . .
RUN mkdir -p data/plans
EXPOSE 80
CMD ["node", "server.js"]
