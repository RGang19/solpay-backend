# Single-stage "Nuclear" Dockerfile for guaranteed source inclusion
FROM node:24-alpine

WORKDIR /app

# Add node_modules/.bin to PATH
ENV PATH="/app/node_modules/.bin:${PATH}"

# Copy all project files early (including src, tsconfig.json, etc.)
COPY . .

# Install ALL dependencies (including tsx)
RUN npm install

# Explicitly verify the presence of src during build
RUN ls -la /app/src

# Generate Prisma Client
RUN npx prisma generate

ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001

# Command to allow debugging and start server
CMD ["npm", "run", "dev"]
