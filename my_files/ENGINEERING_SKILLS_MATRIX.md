# SaaS Engineering Architecture Principles
1. **Strict Code Splitting**: Complete separation of visual layouts (`src/frontend`) from database and business logic drivers (`src/backend`).
2. **Prisma Row Filtering Hooks**: Restricting raw rows directly at the core query engine tier to enforce security boundaries.
3. **Automated Interval State Syncing**: Background polling that updates dashboards every 10 seconds without locking the browser screen.
4. **Tailwind Custom Hex Integrations**: Mapping the custom Futuristic Oceanic Teal theme configurations globally.
