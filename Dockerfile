FROM node:16.17.1-alpine3.16

COPY . /app

WORKDIR /app

# install dependencies
RUN apk add --no-cache --upgrade bash
RUN npm install

# Wait for the database to come up, then start the application
ENTRYPOINT ["npm", "run", "start:docker"]