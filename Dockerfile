# Stage 1: Build the application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies including devDependencies for build
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Build the TypeScript application
RUN npm run build

# Stage 2: Production environment
FROM node:24-alpine AS runner

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm install --omit=dev

# Copy the built application from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Expose the application port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
