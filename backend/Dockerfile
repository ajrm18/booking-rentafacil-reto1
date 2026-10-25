FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Contratos OpenAPI servidos en /api/docs y /api/v2/docs
COPY contracts ./contracts
ENV NODE_ENV=production
# 3000: HTTP REST (/api/v1 y /api/v2) | 50051: gRPC inventory.InventoryStockService
EXPOSE 3000 50051
CMD ["node", "dist/main.js"]
