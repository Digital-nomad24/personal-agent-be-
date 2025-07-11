FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

# Build TypeScript
RUN npm run build

EXPOSE 8000
CMD ["npm", "run", "serve"]
