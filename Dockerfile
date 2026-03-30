# Stage 1: Base image
FROM node:24-alpine AS base

WORKDIR /app

# Add node_modules/.bin to PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy only the necessary files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code explicitly
COPY src ./src
COPY prisma.config.ts ./

# Generate Prisma Client
RUN npx prisma generate

# Stage 2: Development environment (uses tsx)
FROM base AS development

ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001

# Command to allow debugging and start server
CMD ["npm", "run", "dev"]

# Stage 3: Builder for production
FROM base AS builder

RUN npm run build

# Stage 4: Production runner
FROM node:24-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# Copy build output and generated prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Start the application
CMD ["npm", "start"]
