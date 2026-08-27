# Milk Reception App — Development Workflow & Git Handoff Rules

## 1. Branching & Lifecycle Policy

For every future implementation stage:

`
feature/<stage-name>
        ↓
   implementation
        ↓
   required tests (Vitest + isolated test DB & legacy regressions)
        ↓
   secret/staged-file safety check
        ↓
   commit
        ↓
   push feature branch to origin
        ↓
   report commit SHA
`

### Critical Rules:
1. **No Automatic Merges**: Never automatically merge feature branches into develop or main. Explicit review happens first.
2. **Push Policy**: If a stage fails verification, it may be pushed only as a clearly named WIP feature branch and must **NOT** be merged.
3. **No Direct Main Pushes**: Never push directly to main.
4. **Clean Baseline**: The develop branch represents the verified development baseline across completed checkpoints.

---

## 2. Risk-Based Verification Policy

Verification intensity is determined by the architectural risk level of the changes. The coding agent must state the risk level and the rationale for selecting it in the stage report.

### Levels:
1. **LOW RISK**
   - Focused unit/integration tests
   - Typecheck (`npm run typecheck`) where relevant
2. **MEDIUM RISK**
   - Focused unit/integration tests
   - Directly related legacy regression suites
   - Typecheck (`npm run typecheck`)
   - Lint (`npm run lint`) if relevant
3. **HIGH RISK / SHARED CRITICAL CODE / MAJOR CHECKPOINT**
   - Full Vitest suite (`npm run test`)
   - Full 36 legacy regression suite (`npm run test:legacy`)
   - Typecheck (`npm run typecheck`)
   - Lint (`npm run lint`)
   - Production build (`npm run build`)
   - Prisma schema validation & migration status (`npx prisma validate && npx prisma migrate status`)

> **Note**: Do not remove tests or weaken milestone checkpoints. Any unexpected impact on shared authentication, core DB models, or shared formulas warrants automatic risk escalation to HIGH RISK.

---

## 3. Standard Stage Reporting Template

Every future stage report must explicitly include:

```text
GIT BRANCH: <branch-name>
BASE COMMIT: <sha>
FINAL COMMIT: <sha>
REMOTE PUSH: YES / NO
REMOTE BRANCH: <origin/branch-name>
git status --short after commit/push: <output>
```

---

## 4. Public Repository Secret Safety Protocol


The repository is public. The following strict rules apply:
1. .env and .env.test.local must remain strictly ignored (git check-ignore).
2. Never track, stage, or commit:
   - .env, .env.test.local, .env.*.local
   - Database connection strings, passwords, or credentials
   - JWT secrets or private keys
   - Database dumps or scratch repair files
3. Always verify git status and git diff --staged before committing.
