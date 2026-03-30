# Specific dev-mode Dockerfile as requested
FROM node:24-alpine

WORKDIR /app

# Add node_modules/.bin to PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy all project files early
COPY . .

# Install ALL dependencies
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

ENV NODE_ENV=development
ENV PORT=3001
EXPOSE 3001

# Reverted to dev mode as requested
CMD ["npm", "run", "dev"]
