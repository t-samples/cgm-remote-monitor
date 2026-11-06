FROM node:16.16.0-alpine

LABEL maintainer="Nightscout Contributors"

WORKDIR /opt/app
COPY . /opt/app

# npm ci runs the project postinstall once and uses the reviewed lockfile.
RUN npm ci --cache /tmp/build-cache && rm -rf /tmp/build-cache

USER node
EXPOSE 1337

CMD ["node", "lib/server/server.js"]
