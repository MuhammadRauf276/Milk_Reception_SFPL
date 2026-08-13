# Milk Reception & Process Logs Management Application

A production-grade, highly scalable **Next.js** full-stack web application designed for dairy plant operations. Features a **Creamy Minimalist aesthetic** (`#FDFBF7` canvas, `#F4F0E6` panels, `#1E201E` charcoal text) with toggleable **Deep Night mode**, **3D Isometric Icons** for physical steps, a **5-stage vertical Kanban pipeline**, **10-second automatic polling background sync**, **PostgreSQL storage via Prisma ORM (Decimal precision schema)**, **JWT multi-role authentication** (`MPD`, `QA`, `Security_Weight`, `Production`), and real-time stage duration trackers.

---

## Key Features

1. **Styling Theme (Creamy Minimalist & Isometric 3D Components)**:
   - **Default Creamy Theme**: `#FDFBF7` background canvas, `#F4F0E6` Oatmeal Sand panels, `#EAE4D5` hairline borders, `#1E201E` ultra-dark Charcoal text for direct sunlight readability.
   - **Night Theme**: Deep Charcoal `#1E201E` canvas, Slate `#2C302E` panels, Cream text.
   - **3D Isometric Icons**: Glossy, layered 3D-shaded floating isometric shapes for physical steps (`Truck Container`, `Security Pass Badge`, `QA Chemical Flask`, `Balance Scale`, `Unloading Storage Tank`).
   - **Automatic Sync (10s Polling)**: No manual refresh button required; background polling updates the UI every 10 seconds.

2. **System Architecture & 5-Stage Kanban Pipeline**:
   - Permanent left-hand navigation sidebar containing user authentication badges, department role switcher, theme toggle, and live operational stats.
   - 5 distinct vertical Kanban tracking lanes:
     * Lane 1: "En-Route / Dispatched" (3D Truck Container)
     * Lane 2: "Gate 2 Token Desk" (3D Security Pass Badge)
     * Lane 3: "QA Lab Sampling" (3D Chemical Testing Flask)
     * Lane 4: "Weighbridge Scale" (3D Balance Scale)
     * Lane 5: "Silo Milk Reception" (3D Unloading Storage Tank)

3. **Prisma PostgreSQL Schema (`milk_process_logs`)**:
   - Native Decimal / Int / String fields formatted for direct Power BI querying and SQL reporting.

4. **Multi-Role JWT Column Security**:
   - Role-restricted update permissions (`/api/logs/[id]`).
   - Token Modal layout notice:
     > **"Ensure Token is issued in the physical presence of the designated MPD Officer."**

5. **Automated Formulas & Stage Duration Trackers**:
   - `SNF % = (LR / 4) + (0.2 * Fat) + 0.36`
   - `Total Solids (TS %) = Fat % + SNF %`
   - `13% TS Equivalent Liters = (Gross Liters * TS %) / 13.0`
   - `Net Weight = 1st Weight - 2nd Weight`
   - Real-time Stage Durations: Waiting Before Sampling, Sampling Duration, Waiting Before 1st Weight, Waiting Before Reception, Unloading Duration, Gate-to-Gate Total Time.

6. **Mock Fallback Engine**:
   - In-memory database store allows `npm run dev` to work out-of-the-box instantly before connecting a remote PostgreSQL connection string in `.env`.

---

## Local Development Quickstart

1. Navigate to project root:
   ```bash
   cd D:\MilkReceptionApp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run Next.js dev server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000` in your web browser.

---

## Connecting Cloud PostgreSQL (Neon / Supabase / RDS)

1. Set `DATABASE_URL` in `D:\MilkReceptionApp\.env`:
   ```env
   DATABASE_URL="postgresql://username:password@ep-your-db-host.neon.tech/milk_reception_db?sslmode=require"
   JWT_SECRET="your-jwt-secret-key-at-least-32-chars-long"
   ```

2. Push schema to database:
   ```bash
   npx prisma db push
   ```

---

## Initializing Git & Pushing to GitHub

```bash
cd D:\MilkReceptionApp
git init
git add .
git commit -m "Initial commit: Creamy Minimalist 5-Stage Kanban Milk Reception App"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/MilkReceptionApp.git
git push -u origin main
```
