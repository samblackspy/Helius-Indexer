// supabase/functions/helius-webhook-receiver/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Helper to extract relevant accounts from a Helius payload (Keep as before)
function getAccountsFromPayload(payload: any): string[] {
    const accounts = new Set<string>();
    try {
        (payload?.tokenTransfers || []).forEach((t: any) => {
            if (t.fromUserAccount) accounts.add(t.fromUserAccount);
            if (t.toUserAccount) accounts.add(t.toUserAccount);
            if (t.mint) accounts.add(t.mint);
        });
        (payload?.nativeTransfers || []).forEach((t: any) => {
            if (t.fromUserAccount) accounts.add(t.fromUserAccount);
            if (t.toUserAccount) accounts.add(t.toUserAccount);
        });
        const nftEvent = payload?.events?.nft;
        if (nftEvent) {
            if (nftEvent.buyer) accounts.add(nftEvent.buyer);
            if (nftEvent.seller) accounts.add(nftEvent.seller);
            (nftEvent.nfts || []).forEach((nft: any) => { if (nft.mint) accounts.add(nft.mint); });
        }
        (payload?.transaction?.message?.accountKeys || []).forEach((acc: any) => {
             const key = typeof acc === 'string' ? acc : acc?.pubkey;
             if (key) accounts.add(key);
        });
        (payload?.accountData || []).forEach((ad: any) => { if (ad.account) accounts.add(ad.account); });
         if(payload?.source === "PROGRAM_RULE" && payload?.account) { accounts.add(payload.account); }
    } catch (error: unknown) {
         console.error("[getAccountsFromPayload] Error extracting accounts:", error instanceof Error ? error.message : error);
    }
    return Array.from(accounts);
}

// --- Main Request Handler ---
serve(async (req: Request) => {
    if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

    let responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
    let payloads: any[] = [];
    let processingError: Error | null = null;
    let rawBodyForLogging = '[Not Read]';

    try {
        if (req.method !== 'POST') { /* 405 */ }

        // Parse body safely
        rawBodyForLogging = await req.text();
        console.log("Webhook receiver: Raw request body received:", rawBodyForLogging.substring(0, 1000) + (rawBodyForLogging.length > 1000 ? '...' : ''));
        if (!rawBodyForLogging) { /* 200 OK - Empty body */ }
        try { payloads = JSON.parse(rawBodyForLogging); } catch (e) { /* 400 Bad Request */ }
        if (!Array.isArray(payloads)) { /* 200 OK - Not array */ }
        if (payloads.length === 0) { /* 200 OK - Empty array */ }

        console.log(`Webhook receiver: Processing ${payloads.length} event(s) from parsed payload.`);

        // --- START: Revised Job Matching Logic ---

        // 1. Fetch ALL active jobs ONCE per batch
        const { data: allActiveJobs, error: jobFetchError } = await supabaseAdmin
            .from('indexing_jobs')
            .select('id, data_category, category_params') // Only fetch needed fields
            .eq('status', 'active');

        if (jobFetchError) {
            console.error("CRITICAL: Failed to fetch active jobs list:", jobFetchError);
            // If we can't get the job list, we cannot process anything
            throw new Error(`Failed to fetch active jobs: ${jobFetchError.message}`);
        }

        if (!allActiveJobs || allActiveJobs.length === 0) {
             console.log("No active jobs found in database. Skipping event processing.");
             return new Response('Webhook batch received, no active jobs configured.', { status: 200, headers: corsHeaders });
        }

        console.log(`Found ${allActiveJobs.length} total active jobs to check against.`);

        const allQueueInserts: any[] = [];
        let skippedCount = 0;
        let checkedCount = 0;

        // 2. Process each event payload in the batch
        for (const eventPayload of payloads) {
            checkedCount++;
            const signature = eventPayload?.signature || 'N/A';
            const involvedAccounts = getAccountsFromPayload(eventPayload); // Extract accounts relevant to this event

            if (involvedAccounts.length === 0) {
                console.log(`[Event Sig: ${signature}] Skipping event: no identifiable accounts extracted.`);
                skippedCount++;
                continue;
            }
            // Use a Set for efficient checking of involved accounts
            const involvedAccountsSet = new Set(involvedAccounts);

            let queuedForThisEvent = false;

            // 3. Filter ALL active jobs IN CODE against the involved accounts for THIS event
            for (const job of allActiveJobs) {
                let jobMonitoredAddress: string | null = null;
                // Determine the address this specific job monitors
                switch (job.data_category) {
                    case 'MINT_ACTIVITY':
                        jobMonitoredAddress = job.category_params?.mintAddress;
                        break;
                    case 'PROGRAM_INTERACTIONS':
                        jobMonitoredAddress = job.category_params?.programId;
                        break;
                    // Add other categories
                }

                // Check if the job's monitored address is in the set of accounts involved in the current event
                if (jobMonitoredAddress && involvedAccountsSet.has(jobMonitoredAddress)) {
                    console.log(`[Event Sig: ${signature}] MATCH FOUND: Job ${job.id} (Monitors: ${jobMonitoredAddress}) matches involved accounts.`);
                    // If matches, create a queue item for this job and this event payload
                    allQueueInserts.push({
                        job_id: job.id,
                        payload: eventPayload,
                        status: 'pending',
                        processing_attempts: 0,
                    });
                    queuedForThisEvent = true;
                }
                // No need for else log here, too verbose otherwise
            } // End loop through all active jobs

            if (!queuedForThisEvent) {
                 console.log(`[Event Sig: ${signature}] No active jobs found monitoring involved accounts for this event.`);
                 skippedCount++;
            }

        } // End loop through payloads in batch

        // 4. Insert all relevant queue items for the entire batch
        if (allQueueInserts.length > 0) {
            console.log(`Queuing ${allQueueInserts.length} task(s) from processed batch of ${payloads.length} event(s).`);
            const { error: insertError } = await supabaseAdmin
                .from('webhook_queue')
                .insert(allQueueInserts);

            if (insertError) {
                console.error("CRITICAL: Failed to insert batch into webhook_queue:", insertError);
                processingError = new Error(`DB insert failed: ${insertError.message}`);
            }
        } else {
            console.log(`Finished batch processing ${payloads.length} event(s). No relevant events to queue (Skipped: ${skippedCount}).`);
        }
        // --- END: Revised Job Matching Logic ---

        // --- Final Response ---
        if (processingError) {
             console.error("Error occurred during webhook batch processing (but responding 200 to Helius):", processingError);
             return new Response('Webhook batch received, but errors occurred during processing.', { status: 200, headers: corsHeaders });
        } else {
            return new Response('Webhook batch received successfully.', { status: 200, headers: corsHeaders });
        }

    } catch (err: unknown) { // Catch unexpected errors during setup/parsing
        console.error(`Webhook receiver CRITICAL ERROR:`, err);
        const status = (err instanceof SyntaxError) ? 400 : 500;
        const errorMsg = (err instanceof Error) ? err.message : "Internal server error processing webhook";
         return new Response(JSON.stringify({ error: `Webhook processing failed: ${errorMsg}` }), {
             status: status,
             headers: responseHeaders
            });
    }
}); // End of serve