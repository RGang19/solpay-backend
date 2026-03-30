# Stage 1: Base stage for shared tasks
FROM node:24-alpine AS base

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies)
RUN npm install

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application code
COPY . .

# Stage 2: Development environment (uses tsx)
FROM base AS development

# Set environment variables for development
ENV NODE_ENV=development
ENV PORT=3001

# Expose the application port
EXPOSE 3001

# Run the dev script (using tsx watch)
CMD ["npm", "run", "dev"]

# Stage 3: Production builder
FROM base AS builder

# Build the TypeScript application
RUN npm run build

# Stage 4: Lean production image
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

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=3001

# Expose the application port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]
