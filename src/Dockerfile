FROM node:20
WORKDIR /usr/src/code
COPY package*.json ./
RUN npm install
COPY . .
CMD [ "node", "." ]