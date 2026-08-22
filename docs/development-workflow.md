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

## 2. Standard Stage Reporting Template

Every future stage report must explicitly include:

`	ext
GIT BRANCH: <branch-name>
BASE COMMIT: <sha>
FINAL COMMIT: <sha>
REMOTE PUSH: YES / NO
REMOTE BRANCH: <origin/branch-name>
git status --short after commit/push: <output>
`

---

## 3. Public Repository Secret Safety Protocol

The repository is public. The following strict rules apply:
1. .env and .env.test.local must remain strictly ignored (git check-ignore).
2. Never track, stage, or commit:
   - .env, .env.test.local, .env.*.local
   - Database connection strings, passwords, or credentials
   - JWT secrets or private keys
   - Database dumps or scratch repair files
3. Always verify git status and git diff --staged before committing.
