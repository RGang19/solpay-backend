# Contributing to SolPay

Thank you for considering contributing to SolPay! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

- Node.js v20+ (managed via [NVM](https://github.com/nvm-sh/nvm))
- MongoDB Atlas account or local MongoDB instance
- A Solana wallet browser extension (Phantom, Backpack, Solflare, etc.)

### Local Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/RGang19/solpay-frontend.git
   git clone https://github.com/RGang19/solpay-backend.git
   ```

2. **Backend**
   ```bash
   cd solpay-backend
   source ~/.nvm/nvm.sh && nvm use 20
   npm install
   cp .env.example .env  # Fill in your values
   npx prisma generate
   npm run dev
   ```

3. **Frontend**
   ```bash
   cd solpay-frontend
   source ~/.nvm/nvm.sh && nvm use 20
   npm install
   npm run dev
   ```

## Development Guidelines

### Code Style

- TypeScript for all source files
- Use `const` and arrow functions by default
- Use descriptive variable names
- Add JSDoc comments for public API methods

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation changes
- `refactor:` — Code changes that neither fix a bug nor add a feature
- `test:` — Adding or modifying tests
- `chore:` — Maintenance tasks

### Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes with clear commit messages
4. Ensure tests pass (`npm test`)
5. Push to your fork and submit a PR
6. Include a description of what your PR does and link any related issues

### Testing

- Write tests for new features and bug fixes
- Run the test suite before submitting a PR:
  ```bash
  # Backend
  cd solpay-backend && npm test

  # Frontend
  cd solpay-frontend && npm test
  ```

## Project Structure

```
sol-pay/
├── Sol-pay-Backend-main/      # Express + TypeScript API
│   ├── src/
│   │   ├── routes/            # API route handlers
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Auth middleware
│   │   └── config/            # Database config
│   └── prisma/                # Database schema
│
└── solpay-frontend-main/      # React demo app
    ├── src/
    │   ├── pages/             # Route components
    │   ├── components/        # Reusable UI
    │   └── lib/               # API client & utilities
    └── packages/sdk/          # Reusable TypeScript SDK
```

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include reproduction steps and environment details
- Tag issues with appropriate labels

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
