FROM node:26.13.0-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# The runtime image is nginx (no Node, no sources), so CI's in-image unit-test
# step cannot run UI tests. Run them here instead: a failing test fails the build.
RUN npm run test:unit
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html/backtest-ui
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
