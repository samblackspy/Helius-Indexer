# Helius Supabase Indexer

A platform that enables developers to easily index Solana blockchain data into their own Postgres database using Helius Webhooks and Supabase.

## Overview

This platform simplifies blockchain data integration by eliminating the need for users to run their own RPC nodes, Geyser plugins, or complex infrastructure. Users can configure indexing jobs through a simple web UI, specifying which on-chain events (like activity for a specific token mint or program) they want to track and the target table in their own Postgres database.

The platform handles:
* Securely managing user credentials for their target databases.
* Interacting with the Helius API to manage a single platform webhook subscription based on active user jobs.
* Receiving webhook callbacks from Helius.
* Queuing incoming events reliably.
* Processing queued events via a background worker.
* Connecting to the user's specified database (using connection pooling).
* Transforming Helius event data into a predefined schema.
* Inserting the transformed data into the user's target table.

**Core Technologies:**

* **Frontend:** React (Vite, TypeScript, Tailwind CSS)
* **Backend API:** Supabase Edge Functions (Deno)
* **Database (Platform):** Supabase Postgres
* **Authentication:** Supabase Auth
* **Blockchain Data Source:** Helius Webhooks (Enhanced Transactions, Program Notifications)
* **Background Processing:** Node.js Worker (polling Supabase queue table)
* **User Database Target:** PostgreSQL (User-provided)

## Prerequisites

* Node.js (v18 or later recommended)
* npm or yarn
* Git
* A Supabase Account (Free tier sufficient)
* A Helius Account (Free tier recommended, provides API key)
* Access to *your own target* PostgreSQL database where you want the indexed data stored (This can be another Supabase project, AWS RDS, local Docker, etc.)

## Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/samblackspy/Helius-Indexer.git # Replace with your repo URL if different
cd Helius-Indexer
```

### 2. Supabase Project Setup

1.  Go to [supabase.com](https://supabase.com/) and create a new project (or use an existing one).
2.  Note down your **Project URL** and **`anon` (public) key** (Project Settings > API). These are needed for the frontend.
3.  Note down your **`service_role` (secret) key** (Project Settings > API). **Treat this key like a password.** This is needed for the worker and Edge Functions accessing DB directly.
4.  Note down your **Database Password** (Project Settings > Database > Password). This is needed if your *target* database is also this Supabase project.
5.  Get your **Project Ref** ID (Project Settings > General). This is needed for constructing function URLs.

### 3. Helius Setup

1.  Go to [helius.dev](https://helius.dev/) and sign up/log in.
2.  Navigate to the API Keys section (or Developer Settings) and get your **Helius API Key**.
3.  **(Manual Step Required):** You must create the single platform webhook manually via the Helius API (using `curl`, Postman, or a script) or their dashboard if available. Configure it as follows:
    * **`webhookURL`**: Set this to your deployed `helius-webhook-receiver` Edge Function URL: `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/helius-webhook-receiver` (Replace `<YOUR_PROJECT_REF>`).
    * **`transactionTypes`**: Set to `["ANY"]`.
    * **`accountAddresses`**: Start with an empty array `[]`. The `manage-jobs` function will dynamically update this list via the Helius Edit API.
    * **`webhookType`**: Set to `"enhanced"`.
    * **`authHeader`**: (Optional but Recommended) Set a secret header value here that your `helius-webhook-receiver` function can verify.
    * After creating the webhook, note down the **`webhookID`** returned by Helius.

### 4. Configure Environment Variables & Secrets

1. **Supabase Secrets (Required for Edge Functions):**
    * Go to Supabase Dashboard -> Project Settings -> Edge Functions -> Secrets.
    * Add the following secrets:
        ```env
        ENCRYPTION_KEY=YOUR_32_BYTE_HEX_ENCRYPTION_KEY
        HELIUS_API_KEY=YOUR_HELIUS_API_KEY
        PLATFORM_HELIUS_WEBHOOK_ID=YOUR_HELIUS_WEBHOOK_ID
        SUPABASE_REF=YOUR_SUPABASE_PROJECT_REF
        ```

2. **Frontend (`/helius-supabase-indexer-ui` directory):**
    ```env
    VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
    VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
    ```

3. **Worker (`/helius-indexer-worker` directory):**
    ```env
    SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
    SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
    ENCRYPTION_KEY=YOUR_32_BYTE_HEX_ENCRYPTION_KEY
    ```

### 5. Install Dependencies

```bash
# In frontend root directory (helius-supabase-indexer-ui)
npm install

# In worker directory (helius-indexer-worker)
npm install
```

### 6. Deploy Edge Functions & Run Locally

1. **Deploy Functions:**
    ```bash
    npx supabase functions deploy manage-credentials --no-verify-jwt
    npx supabase functions deploy manage-jobs --no-verify-jwt
    npx supabase functions deploy helius-webhook-receiver --no-verify-jwt
    ```
2. **Start Worker:**
    ```bash
    # In helius-indexer-worker directory
    npm run dev
    ```
3. **Start Frontend:**
    ```bash
    # In helius-supabase-indexer-ui directory
    npm run dev
    ```
4. Access the application in your browser (e.g., `http://localhost:5173`).

## Required Target Table Schemas (For User's Database)

Users must create tables matching these schemas in their own target Postgres database *before* creating an indexing job for the corresponding category.

### Category: `MINT_ACTIVITY`

```sql
CREATE TABLE public.helius_mint_activity (
    tx_signature TEXT PRIMARY KEY NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    monitored_mint_address TEXT NOT NULL,
    tx_type TEXT,
    fee_sol NUMERIC,
    success BOOLEAN,
    involved_accounts TEXT[],
    token_transfers JSONB,
    raw_payload JSONB NOT NULL,
    worker_processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Category: `PROGRAM_INTERACTIONS`

```sql
CREATE TABLE public.helius_program_activity (
    tx_signature TEXT NOT NULL,
    instruction_index SMALLINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    monitored_program_id TEXT NOT NULL,
    instruction_name TEXT,
    accounts JSONB,
    data TEXT,
    fee_sol NUMERIC,
    success BOOLEAN,
    signers TEXT[],
    raw_payload JSONB NOT NULL,
    worker_processed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tx_signature, instruction_index)
);
```

## Conclusion

This platform provides a scalable and efficient way to index Solana blockchain data into a user-managed PostgreSQL database using Supabase and Helius Webhooks.
