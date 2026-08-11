# Coins — Node server: file tĩnh + proxy Binance + Web Push + vòng quét tín hiệu
FROM node:22-alpine

WORKDIR /app
COPY server/package.json server/
RUN cd server && npm install --omit=dev

COPY index.html sw.js manifest.webmanifest ./
COPY css/ css/
COPY js/ js/
COPY icons/ icons/
COPY server/server.js server/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["node", "server/server.js"]
