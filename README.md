
# Helius Supabase Indexer

A platform that enables developers to easily index Solana blockchain data into their own Postgres database using Helius Webhooks and Supabase.

## Overview

This platform simplifies blockchain data integration by eliminating the need for users to run their own RPC nodes, Geyser plugins, or complex infrastructure. Users can configure indexing jobs through a simple web UI, specifying which on-chain events (like activity for a specific token mint or program) they want to track and the target table in their own Postgres database.

The platform handles:
- Securely managing user credentials for their target databases.
- Interacting with the Helius API to manage a single platform webhook subscription based on active user jobs.
- Receiving webhook callbacks from Helius.
- Queuing incoming events reliably.
- Processing queued events via a background worker.
- Connecting to the user's specified database (using connection pooling).
- Transforming Helius event data into a predefined schema.
- Inserting the transformed data into the user's target table.

### Core Technologies

- **Frontend:** React (Vite, TypeScript, Tailwind CSS)
- **Backend API:** Supabase Edge Functions (Deno)
- **Database (Platform):** Supabase Postgres
- **Authentication:** Supabase Auth
- **Blockchain Data Source:** Helius Webhooks (Enhanced Transactions, Program Notifications)
- **Background Processing:** Node.js Worker (polling Supabase queue table)
- **User Database Target:** PostgreSQL (User-provided)

---

## Prerequisites

- Node.js (v18 or later recommended)
- npm or yarn
- Git
- A Supabase Account (Free tier sufficient)
- A Helius Account (Free tier recommended, provides API key)
- Access to your own target PostgreSQL database

---

## Setup Instructions

### 1. Clone Repository

```bash
git clone https://github.com/samblackspy/Helius-Indexer.git
cd Helius-Indexer
```

### 2. Supabase Project Setup

- Go to [supabase.com](https://supabase.com) and create a new project.
- Note down:
  - Project URL
  - Anon (public) key
  - Service role key
  - Database password
  - Project Ref ID

### 3. Helius Setup

- Go to [helius.dev](https://helius.dev) and sign up/log in.
- Get your Helius API Key.
- Create a single platform webhook:

```json
{
  "webhookURL": "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/helius-webhook-receiver",
  "transactionTypes": ["ANY"],
  "accountAddresses": [],
  "webhookType": "enhanced", //use "enhancedDevnet" for devnet
  "authHeader": "your-secret-header" // optional
}
```

- Note the returned `webhookID`.

### 4. Configure Environment Variables & Secrets

#### Supabase Secrets

In Supabase Dashboard → Project Settings → Edge Functions → Secrets:

- `ENCRYPTION_KEY`: Generate using:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `HELIUS_API_KEY`: Your Helius API key
- `PLATFORM_HELIUS_WEBHOOK_ID`: Webhook ID from above
- `SUPABASE_REF`: Your Supabase Project Ref ID

#### Frontend (.env.local)

Inside `/helius-supabase-indexer-ui`:

```env
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

#### Worker (.env)

Inside `/helius-indexer-worker`:

```env
SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
ENCRYPTION_KEY=YOUR_SECURE_32_BYTE_HEX_ENCRYPTION_KEY

# Optional Worker Config
# WORKER_POLL_INTERVAL=5000
# MAX_PROCESSING_ATTEMPTS=3
```

---

### 5. Database Setup (Platform Supabase Project)

#### Create Platform Tables

```sql
-- User DB Credentials Table
CREATE TABLE public.db_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    alias text,
    host text NOT NULL,
    port integer NOT NULL CHECK ((port > 0 AND port <= 65535)),
    db_name text NOT NULL,
    username text NOT NULL,
    encrypted_password text NOT NULL,
    ssl_mode text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);
COMMENT ON COLUMN public.db_credentials.encrypted_password IS 'Stores the user''s external DB password, encrypted server-side.';
CREATE INDEX IF NOT EXISTS idx_db_credentials_user_id ON public.db_credentials(user_id);

-- Indexing Jobs Table
CREATE TABLE public.indexing_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    credential_id uuid REFERENCES public.db_credentials(id) ON DELETE CASCADE NOT NULL,
    internal_hook_id UUID UNIQUE DEFAULT gen_random_uuid(),
    data_category text NOT NULL,
    category_params jsonb,
    target_table_name text NOT NULL,
    predefined_schema_name text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_event_at timestamp with time zone,
    error_message text
);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_user_id ON public.indexing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON public.indexing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_credential_id ON public.indexing_jobs(credential_id);

-- Webhook Queue Table
CREATE TABLE public.webhook_queue (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID REFERENCES public.indexing_jobs(id) ON DELETE CASCADE NOT NULL,
    received_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    processing_attempts INT DEFAULT 0 NOT NULL,
    last_attempt TIMESTAMPTZ,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_status_attempts ON public.webhook_queue(status, processing_attempts, received_at);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_job_id ON public.webhook_queue(job_id);
```

#### Create Locking Function

```sql
CREATE OR REPLACE FUNCTION public.lock_and_get_queue_item(max_attempts integer)
RETURNS SETOF public.webhook_queue
LANGUAGE plpgsql
AS $$
DECLARE
    locked_item_id bigint;
BEGIN
    SELECT id INTO locked_item_id
    FROM public.webhook_queue
    WHERE status = 'pending' AND processing_attempts < max_attempts
    ORDER BY received_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF locked_item_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY UPDATE public.webhook_queue
    SET
        status = 'processing',
        processing_attempts = processing_attempts + 1,
        last_attempt = NOW()
    WHERE id = locked_item_id
    RETURNING *;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_and_get_queue_item(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_and_get_queue_item(integer) TO service_role;
```

---

### 6. Disable RLS (Recommended for Now)

```sql
ALTER TABLE public.db_credentials DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_jobs DISABLE ROW LEVEL SECURITY;
```

---

### 7. Install Dependencies

```bash
# Frontend
cd helius-supabase-indexer-ui
npm install

# Worker
cd ../helius-indexer-worker
npm install
```

---

### 8. Deploy Edge Functions

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>

npx supabase functions deploy manage-credentials --no-verify-jwt
npx supabase functions deploy manage-jobs --no-verify-jwt
npx supabase functions deploy helius-webhook-receiver --no-verify-jwt
```

---

### 9. Start the Worker

```bash
cd helius-indexer-worker
npm run dev
```

---

### 10. Start the Frontend

```bash
cd helius-supabase-indexer-ui
npm run dev
```

Visit: `http://localhost:5173`

---

## Required Target Table Schemas

### `MINT_ACTIVITY`

```sql
CREATE TABLE public.helius_mint_activity (
    tx_signature TEXT PRIMARY KEY NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    slot BIGINT,
    monitored_mint_address TEXT NOT NULL,
    tx_type TEXT,
    fee_sol NUMERIC,
    success BOOLEAN,
    involved_accounts TEXT[],
    token_transfers JSONB,
    nft_events JSONB,
    instructions JSONB,
    log_messages TEXT[],
    raw_payload JSONB NOT NULL,
    worker_processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hma_block_time ON public.helius_mint_activity(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_hma_monitored_mint ON public.helius_mint_activity(monitored_mint_address);
CREATE INDEX IF NOT EXISTS idx_hma_tx_type ON public.helius_mint_activity(tx_type);
CREATE INDEX IF NOT EXISTS idx_hma_success ON public.helius_mint_activity(success);
```

### `PROGRAM_INTERACTIONS`

```sql
CREATE TABLE public.helius_program_activity (
    tx_signature TEXT NOT NULL,
    instruction_index SMALLINT NOT NULL,
    inner_instruction_index SMALLINT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    slot BIGINT,
    monitored_program_id TEXT NOT NULL,
    instruction_name TEXT,
    accounts JSONB,
    data TEXT,
    fee_sol NUMERIC,
    success BOOLEAN,
    signers TEXT[],
    raw_payload JSONB NOT NULL,
    worker_processed_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT helius_program_activity_pkey PRIMARY KEY (tx_signature, instruction_index, inner_instruction_index)
);

CREATE INDEX IF NOT EXISTS idx_hpa_block_time ON public.helius_program_activity(block_time DESC);
CREATE INDEX IF NOT EXISTS idx_hpa_program_id ON public.helius_program_activity(monitored_program_id);
CREATE INDEX IF NOT EXISTS idx_hpa_ix_name ON public.helius_program_activity(instruction_name);
CREATE INDEX IF NOT EXISTS idx_hpa_success ON public.helius_program_activity(success);
```

---

## Basic Usage Guide

1. **Login** via the frontend (e.g., `http://localhost:5173`)
2. **Add Target DB Credentials** via the Credentials tab.
   - Use Connection Pooler if available.
   - Test the connection after saving.
3. **Create an Indexing Job**
   - Choose a saved credential.
   - Select a category (`MINT_ACTIVITY`, `PROGRAM_INTERACTIONS`).
   - Provide required parameters (like mint address).
   - Input the matching target table name (e.g., `helius_mint_activity`).
4. **Monitor Jobs**
   - Ensure the job shows as "active".
   - The worker will process matching Helius events and insert them into your target DB.

---

## License

MIT
