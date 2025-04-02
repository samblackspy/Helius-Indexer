// src/index.ts
// Load environment variables from .env file first
require('dotenv').config();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool, PoolClient, PoolConfig } from 'pg'; // Use pg Pool for user DB connections
import { decrypt } from './crypto'; // Import our Node.js crypto helper

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL || '5000', 10);
const MAX_PROCESSING_ATTEMPTS = parseInt(process.env.MAX_PROCESSING_ATTEMPTS || '3', 10);

// Validate essential config
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !process.env.ENCRYPTION_KEY) {
    console.error("FATAL: Missing required environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY)");
    process.exit(1);
}

// --- Supabase Admin Client ---
const supabaseAdmin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- User DB Connection Pool Cache ---
// Cache pools to avoid reconnecting constantly for the same user DB
const userDbPools = new Map<string, Pool>();

async function getUserDbPool(credential: any): Promise<Pool> {
    const poolKey = credential.id; // Use credential ID as cache key
    if (userDbPools.has(poolKey)) {
        return userDbPools.get(poolKey)!;
    }

    let decryptedPassword;
    try {
        decryptedPassword = decrypt(credential.encrypted_password);
    } catch (e: unknown) { // Catch unknown
        const errorMsg = (e instanceof Error) ? e.message : 'Unknown decryption error';
        console.error(`[Job ${credential.job_id}] Decryption failed for credential ${credential.id}: ${errorMsg}`);
        throw new Error('Password decryption failed'); // Propagate error
    }

    console.log(`[Job ${credential.job_id}] Creating new connection pool for credential ${credential.id} (${credential.username}@${credential.host})`);

    // Determine SSL options based on user's stored preference
    const sslOptions: PoolConfig['ssl'] =
        (credential.ssl_mode === 'require' || credential.ssl_mode === 'allow' || credential.ssl_mode === 'prefer')
            ? { rejectUnauthorized: false } // Basic SSL, user accepts risk if cert invalid.
            : false; // false for 'disable' or null/undefined

    const pool = new Pool({
        host: credential.host,
        port: credential.port,
        database: credential.db_name,
        user: credential.username,
        password: decryptedPassword,
        ssl: sslOptions,
        max: 5, // Max connections per pool
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 10000, // Timeout for acquiring connection (10s)
    });

    // Add error listener to the pool for logging idle client errors etc.
    pool.on('error', (err, client) => {
        console.error(`[Pool Error - Cred ${credential.id}] Idle client error:`, err.message, err.stack);
    });


    // Test connection on pool creation
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        console.log(`[Job ${credential.job_id}] Connection pool test OK for credential ${credential.id}`);
    } catch (err: unknown) { // Catch unknown
        const errorMsg = (err instanceof Error) ? err.message : 'Unknown connection error';
        console.error(`[Job ${credential.job_id}] Connection pool creation FAILED for credential ${credential.id}: ${errorMsg}`);
        await pool.end().catch(e => console.error("Error closing failed pool:", e));
        throw new Error(`Failed to connect to user DB: ${errorMsg}`); // Propagate error so processQueueItem knows
    }

    userDbPools.set(poolKey, pool);
    return pool;
}


// --- Data Transformation Logic ---

function transformMintActivity(payload: any, jobParams: Record<string, any>): { columns: string[]; values: any[] } | null {
    // Updated based on Helius 'enhanced' payload example (NFT_SALE)
    try {
        const signature = payload?.signature;
        const blockTime = payload?.timestamp ? new Date(payload.timestamp * 1000).toISOString() : null; // Use root timestamp
        const slot = payload?.slot ?? null;
        const fee = payload?.fee ? payload.fee / 1_000_000_000 : null;
        const success = payload?.meta?.err === null;
        const tx_type = payload?.type ?? 'UNKNOWN';
        const monitoredMint = jobParams?.mintAddress;

        let involvedAccounts: string[] = [];
        if (payload?.accountData?.length > 0) {
             involvedAccounts = payload.accountData.map((ad: any) => ad.account).filter(Boolean);
        } else if (payload?.transaction?.message?.accountKeys?.length > 0) {
             involvedAccounts = payload.transaction.message.accountKeys.map((acc: any) => typeof acc === 'string' ? acc : acc?.pubkey).filter(Boolean);
        }

        const tokenTransfers = payload?.tokenTransfers ?? null;
        const nftEventsObject = payload?.events?.nft ?? null;
        const instructions = payload?.transaction?.message?.instructions ?? null;
        const logMessages = payload?.meta?.logMessages ?? null;

        if (!signature || !blockTime || !monitoredMint) {
             console.warn(`[Transform ${tx_type}] Skipping: Missing essential fields (signature, blockTime, monitoredMint) for job monitoring ${monitoredMint}. Sig: ${signature}`);
             return null;
        }

        const isMintInvolved = involvedAccounts.includes(monitoredMint) ||
                              (tokenTransfers || []).some((t:any) => t.mint === monitoredMint) ||
                              (nftEventsObject?.nfts || []).some((n:any) => n.mint === monitoredMint);

        if (!isMintInvolved) {
             console.log(`[Transform ${tx_type}] Skipping: Monitored mint ${monitoredMint} not found in involved accounts/events for sig ${signature}.`);
             return null;
        }

        return {
            columns: [
                'tx_signature', 'block_time', 'slot', 'monitored_mint_address',
                'tx_type', 'fee_sol', 'success', 'involved_accounts',
                'token_transfers', 'nft_events', 'instructions', 'log_messages',
                'raw_payload'
            ],
            values: [
                signature, blockTime, slot, monitoredMint,
                tx_type, fee, success, involvedAccounts,
                tokenTransfers ? JSON.stringify(tokenTransfers) : null,
                nftEventsObject ? JSON.stringify(nftEventsObject) : null,
                instructions ? JSON.stringify(instructions) : null,
                logMessages,
                JSON.stringify(payload)
            ]
        };
    } catch (e: unknown) { // Catch unknown
        const errorMsg = (e instanceof Error) ? e.message : 'Unknown transformation error';
        console.error(`[Transform ${payload?.type || 'Unknown'}] Error transforming Mint Activity payload:`, errorMsg, "Sig:", payload?.signature, "Payload Snippet:", JSON.stringify(payload).substring(0, 500));
        return null;
    }
}

// Placeholder for Program Interaction Transformation
function transformProgramInteraction(payload: any, jobParams: Record<string, any>): { columns: string[]; values: any[] } | null {
    console.warn("transformProgramInteraction not implemented yet. Payload:", JSON.stringify(payload).substring(0, 500));
    return null;
}

// --- Queue Item Processing Logic (MODIFIED JOB FETCH) ---
async function processQueueItem(item: any) {
    console.log(`[Job ${item.job_id}] Processing queue item ${item.id}`);
    let userDbClient: PoolClient | null = null;
    let updateStatus: 'processed' | 'failed' = 'failed'; // Default to failed
    let errorMessage: string | null = null;
    let jobData: any = null; // Store job data for access in finally block
    let credentialData: any = null; // Store credential data separately

    try {
        // --- MODIFICATION START: Fetch Job WITHOUT .single() ---

        // 1a. Fetch Job Details ONLY (WITHOUT .single())
        console.log(`[Job ${item.job_id}] Fetching job details for ID: ${item.job_id} WITHOUT .single()...`);
        const { data: fetchedJobDataArray, error: jobFetchError } = await supabaseAdmin
            .from('indexing_jobs')
            .select(`id, credential_id, data_category, category_params, target_table_name, status`) // Select needed fields
            .eq('id', item.job_id); // REMOVED .single()

        // Log the raw result array and any error
        console.log(`[Job ${item.job_id}] Job fetch result (array):`, fetchedJobDataArray); // ADDED LOG
        console.log(`[Job ${item.job_id}] Job fetch error:`, jobFetchError); // ADDED LOG (will be null on success)

        // Manually check the result array
        if (jobFetchError) {
            updateStatus = 'failed'; // Mark failed if DB query itself errored
            throw new Error(`DB error fetching job details: ${jobFetchError.message}`);
        }
        if (!fetchedJobDataArray || fetchedJobDataArray.length === 0) {
            // If query truly returns no rows
            updateStatus = 'processed'; // Treat as processed if job truly not found
            throw new Error(`Job details query returned no rows for job ${item.job_id} (perhaps deleted?).`);
        }
        if (fetchedJobDataArray.length > 1) {
             // This should be impossible with primary key 'id'
             console.error(`CRITICAL: Found multiple rows for job ID ${item.job_id}! Check primary key constraint.`);
             updateStatus = 'failed';
             throw new Error(`Inconsistent state: Multiple jobs found for ID ${item.job_id}.`);
        }

        // If we get here, exactly one job was found in the array
        const fetchedJobData = fetchedJobDataArray[0]; // Get the single job object
        jobData = fetchedJobData; // Assign job data
        console.log(`[Job ${item.job_id}] Found job from array. Status: ${jobData.status}, Credential ID: ${jobData.credential_id}`);

        // --- MODIFICATION END ---


        // Check job status *after* confirming job exists
        if (jobData.status !== 'active') {
             console.log(`[Job ${item.job_id}] Job status is ${jobData.status}, skipping processing queue item ${item.id}`);
             updateStatus = 'processed'; // Mark as processed to remove from queue
             throw new Error('Job not active'); // Skip to finally block
        }

        // 1b. Fetch Credential Details Separately using credential_id from job (Keep using .single() here)
        if (!jobData.credential_id) {
            // This case indicates bad data in indexing_jobs table
            updateStatus = 'failed'; // Mark as failed, needs investigation
            throw new Error(`Job ${item.job_id} is missing required credential_id.`);
        }
        console.log(`[Job ${item.job_id}] Fetching credential details for ID: ${jobData.credential_id}`);
        const { data: fetchedCredentialData, error: credFetchError } = await supabaseAdmin
            .from('db_credentials')
            .select('*') // Select all credential fields
            .eq('id', jobData.credential_id)
            .single(); // Expect exactly one credential

        if (credFetchError || !fetchedCredentialData) {
            // If the credential isn't found, update job to error state and mark queue item as failed
            errorMessage = `Credential details not found for credential ID ${jobData.credential_id} linked to job ${item.job_id} (perhaps deleted?): ${credFetchError?.message || 'Not found / PGRST116'}`;
            updateStatus = 'failed'; // Keep as failed, maybe retries won't help but reflects an issue
            // Update the main job status to error (async, don't wait)
             supabaseAdmin.from('indexing_jobs').update({ status: 'error', error_message: `Credential missing: ${jobData.credential_id}` }).eq('id', item.job_id)
                .then(({error: updateJobErr}) => { if(updateJobErr) console.error(`[Job ${item.job_id}] Failed to update job status to error for missing credential:`, updateJobErr); });
            throw new Error(errorMessage); // Throw to reach finally block
        }
        credentialData = fetchedCredentialData; // Assign credential data
        console.log(`[Job ${item.job_id}] Found credential details for ${credentialData.id}`);


        // 2. Get User DB Connection Pool (Handles decryption)
        const pool = await getUserDbPool({ ...credentialData, job_id: item.job_id });
        userDbClient = await pool.connect();

        // 3. Transform Payload
        let transformResult: { columns: string[]; values: any[] } | null = null;
        switch (jobData.data_category) {
            case 'MINT_ACTIVITY':
                transformResult = transformMintActivity(item.payload, jobData.category_params);
                break;
            case 'PROGRAM_INTERACTIONS':
                transformResult = transformProgramInteraction(item.payload, jobData.category_params);
                break;
            default:
                throw new Error(`Unsupported data_category: ${jobData.data_category}`);
        }

        if (!transformResult) {
             updateStatus = 'processed';
             throw new Error(`Payload transformation failed or skipped for category ${jobData.data_category}.`);
        }

        const { columns, values } = transformResult;

        // 4. Construct and Execute SQL
        const columnNames = columns.map(col => `"${col}"`).join(', ');
        const valuePlaceholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const targetTable = jobData.target_table_name;
        if (!/^[a-zA-Z0-9_]+$/.test(targetTable)) {
           throw new Error(`Invalid target table name specified: ${targetTable}`);
        }
        const sqlText = `INSERT INTO public."${targetTable}" (${columnNames}) VALUES (${valuePlaceholders}) ON CONFLICT (tx_signature) DO NOTHING`;

        console.log(`[Job ${item.job_id}] Executing SQL for queue item ${item.id}: INSERT INTO public."${targetTable}"`);
        await userDbClient.query(sqlText, values);

        updateStatus = 'processed';
        console.log(`[Job ${item.job_id}] Successfully processed queue item ${item.id}`);

    } catch (err: unknown) { // Catch errors from any step
        const error = err instanceof Error ? err : new Error('Unknown processing error');
        // Avoid logging the same error twice if it was already handled (like job not active)
        if (errorMessage !== error.message) {
            console.error(`[Job ${item.job_id || 'Unknown'}] FAILED processing queue item ${item.id || 'Unknown'}:`, error.message);
            errorMessage = error.message || 'Unknown processing error';
        }
        // Only mark as failed if it wasn't intentionally skipped/processed
        updateStatus = (updateStatus === 'processed') ? 'processed' : 'failed';

        // Check for potential target table errors (only if jobData exists and status is failed)
        if (jobData && item?.id && updateStatus === 'failed') {
            const isTableError = errorMessage.includes(`relation "public.${jobData.target_table_name}" does not exist`) ||
                                 errorMessage.includes('column') ||
                                 errorMessage.includes('type');
            if (isTableError) {
                console.warn(`[Job ${item.job_id}] Potential target table issue detected. Updating job status to error.`);
                errorMessage = `Target table error: ${errorMessage.substring(0, 250)}`; // Truncate
                // Update job status asynchronously
                supabaseAdmin
                    .from('indexing_jobs')
                    .update({ status: 'error', error_message: errorMessage })
                    .eq('id', item.job_id)
                    .then(({ error: updateJobError }) => {
                        if (updateJobError) {
                            console.error(`[Job ${item.job_id}] Failed to update job status to error:`, updateJobError.message);
                        }
                    });
            }
        }

    } finally {
        // 5. Release User DB Client
        if (userDbClient) {
            userDbClient.release();
        }

        // 6. Update Queue Item Status (only if item.id is valid)
        if (item?.id) {
             // Update queue item asynchronously
             supabaseAdmin
                .from('webhook_queue')
                .update({
                    status: updateStatus,
                    error_message: errorMessage,
                    last_attempt: new Date().toISOString(),
                })
                .eq('id', item.id)
                 .then(({ error: updateError }) => {
                    if (updateError) {
                        console.error(`[Job ${item.job_id || 'Unknown'}] CRITICAL: Failed to update queue item ${item.id} status to ${updateStatus} after processing:`, updateError.message);
                    } else {
                         console.log(`[Job ${item.job_id || 'Unknown'}] Updated queue item ${item.id} status to ${updateStatus}.`);
                    }
                 });
        } else {
             console.error(`[Worker] Cannot update queue status because item ID is missing or processing failed very early.`);
        }
    }
} // End of processQueueItem


// --- Main Polling Loop ---
async function pollQueue() {
    if ((pollQueue as any).isRunning) { return; }
    (pollQueue as any).isRunning = true;
    console.log('Polling webhook queue for pending items...'); // Keep this log

    try {
        const { data: rpcData, error: lockError } = await supabaseAdmin.rpc(
            'lock_and_get_queue_item', // Ensure function name matches exactly
            { max_attempts: MAX_PROCESSING_ATTEMPTS }
        );

        if (lockError) {
            console.error("Error calling lock_and_get_queue_item RPC:", lockError.message);
        } else {
             const item = (Array.isArray(rpcData) && rpcData.length > 0) ? rpcData[0] : null;
             if (item && item.id) {
                 console.log(`Locked queue item ${item.id} for job ${item.job_id}`); // Keep this log
                 processQueueItem(item).catch(err => {
                      console.error(`[Worker] Unhandled error during processQueueItem for item ${item.id}:`, err);
                 });
             } else {
                 console.log('No lockable pending items found in this poll.'); // Keep this log
             }
        }
    } catch (error: unknown) { // Catch unknown
        if (error instanceof Error) { console.error('Error in polling loop:', error.message); }
        else { console.error('Unknown error in polling loop:', error); }
    } finally {
        (pollQueue as any).isRunning = false;
        setTimeout(pollQueue, WORKER_POLL_INTERVAL);
    }
} // End of pollQueue


// --- DB Helper Function for Atomic Locking (Relies on Manual Creation Now) ---
async function addLockingFunction() {
     console.log("Ensuring lock_and_get_queue_item function exists...");
     console.warn("Worker relies on manual creation of DB function 'lock_and_get_queue_item' via Supabase SQL Editor.");
     try {
         console.log("DB function 'lock_and_get_queue_item' assumed to be ready.");
     } catch(error) {
          console.error("Error during DB function setup check:", error);
          console.error("CRITICAL WARNING: Could not verify DB locking function. Ensure 'lock_and_get_queue_item' exists manually via Supabase SQL Editor, otherwise worker polling will fail.");
     }
 }

// --- Initial Startup ---
console.log(`Starting Helius Indexer Worker... Poll Interval: ${WORKER_POLL_INTERVAL}ms, Max Attempts: ${MAX_PROCESSING_ATTEMPTS}`);
addLockingFunction().then(() => {
    console.log("Attempting to start first poll..."); // Keep this log
    pollQueue(); // Start the first poll
}).catch(err => {
     console.error("Worker cannot start due to UNEXPECTED error during DB function check:", err);
     process.exit(1);
});


// --- Graceful Shutdown & Unhandled Error handlers ---
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: Shutting down worker...');
    // TODO: Implement mechanism to stop polling gracefully if possible
    console.log(`Closing ${userDbPools.size} cached user DB pools...`);
    Promise.all(Array.from(userDbPools.values()).map(pool => pool.end()))
        .then(() => {
            console.log('DB pools closed. Exiting.');
            process.exit(0); // Success
        })
        .catch(err => {
            console.error('Error closing pools during shutdown:', err);
            process.exit(1); // Exit with error
        });
    setTimeout(() => {
        console.error('Shutdown timed out. Forcing exit.');
        process.exit(1);
    }, 10000); // 10 seconds timeout
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
   process.exit(1); // Exit on uncaught exceptions
});