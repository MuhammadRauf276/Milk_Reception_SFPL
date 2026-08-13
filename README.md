# Milk_Reception_SFPL

Milk Reception Management System for **Shakarganj Food Products Ltd. (SFPL)**.

This application manages the complete milk reception workflow from dispatch through plant reception, quality testing, weighing, unloading, silo receipt, and gate exit.

## Technology Stack

* Next.js
* TypeScript
* PostgreSQL
* Prisma ORM
* Tailwind CSS
* JWT-based authentication

## Current Architecture

```text
Next.js Application
        ↓
Backend APIs / Services
        ↓
Prisma ORM
        ↓
PostgreSQL
```

PostgreSQL is the authoritative source of truth for operational data.

## Main Operational Modules

* MPD Dispatch
* Security / Gate Entry & Exit
* Plant QA
* Weighbridge
* Production / Unloading
* Silo Inventory
* Super Admin

## Vehicle Reception Workflow

```text
DISPATCHED
→ TOKEN_ISSUED
→ PLANT_QA
→ READY_FOR_GROSS
→ GROSS_WEIGHED
→ READY_FOR_UNLOADING
→ UNLOADING
→ READY_FOR_TARE
→ TARE_WEIGHED
→ READY_FOR_GATE_EXIT
→ COMPLETED
```

All-rejected vehicles bypass weighing, unloading, tare, and final silo receipt and may proceed directly to gate exit after QA completion.

## Operational Time Model

The system keeps the following concepts separate:

* **Operational Date & Time** — actual physical event time
* **Submitted At** — server timestamp when the event was saved
* **Performed By** — authenticated user who performed/submitted the action
* **Business Date** — plant reporting date based on the 08:00 AM cutoff

Plant timezone:

```text
Asia/Karachi
```

Business day:

```text
08:00 AM
to
07:59:59.999 AM next calendar day
```

## Milk Formula Authority

The application uses a centralized backend formula helper.

```text
SNF % = LR / 4 + (0.22 × Fat %) + 0.72

TS % = Fat % + SNF %

SNF : Fat Ratio = SNF % / Fat %

Density = 1 + LR / 1000

Physical Liters = Quantity Kg / Density

@13 TS Liters = Physical Liters × TS / 13
```

## Final Silo Receipt

Final milk receipt is recorded at vehicle level.

Canonical idempotency key:

```text
FINAL_RECEIPT:VISIT:<visitId>
```

Gross, Tare, Net Kg, Physical Liters, and Final Silo Receipt belong to the vehicle reception process.

## Procurement Sources

Current operational source configuration includes:

* ZMCC Hasilpur
* ZMCC Jhang
* ZMCC Kabirwala
* Al Mehmood Dairy
* Al Khair Dairy

Visits use a real `procurement_source_id` relation rather than hardcoded source names.

## Development Database

Development currently uses local PostgreSQL.

The project contains versioned Prisma migrations and can recreate the database schema using:

```bash
npx prisma migrate deploy
```

For development schema changes, use:

```bash
npx prisma migrate dev
```

Do not use `prisma db push` as the normal deployment workflow.

## Local Development

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npx prisma generate
```

Run database migrations:

```bash
npx prisma migrate deploy
```

Start development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Create a local `.env` file.

Example structure:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
JWT_SECRET="your-secret"
```

The real `.env` file must not be committed to GitHub.

Use `.env.example` for documenting required environment variables.

## Development Safety

The following should not be committed:

```text
.env
node_modules/
.next/
log files
local build/cache files
```

These are excluded through `.gitignore`.

## Testing

The project includes regression and integrity test scripts covering areas such as:

* workflow status transitions
* QA chronology
* business-date handling
* dispatch validation
* source relationships
* silo receipt
* formula consistency
* authentication
* operational audit timestamps

Common checks:

```bash
npx tsx scripts/run_all_regressions.ts
npx prisma validate
npx prisma generate
npm run lint
npx next build
```

## Deployment

Production deployment has not been finalized.

The application is intentionally kept PostgreSQL/Prisma based and provider-neutral so it can later run against:

* company-hosted PostgreSQL
* managed PostgreSQL for staging/testing
* standard Next.js Node/Docker deployment

Cloud-specific infrastructure is not required for current local development.

## Repository

This repository contains the development source code for the SFPL Milk Reception Management System.

The application is currently under active development.
