// supabase/functions/manage-jobs/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts'; // Assuming cors.ts helper exists

// --- Platform Helius Config from Secrets ---
const HELIUS_API_KEY = Deno.env.get('HELIUS_API_KEY');
const PLATFORM_WEBHOOK_ID = Deno.env.get('PLATFORM_HELIUS_WEBHOOK_ID'); // The ID of the single platform webhook
const HELIUS_API_BASE_URL = "https://api.helius.xyz/v0/webhooks"; // Base URL

// Check for essential environment variables at startup
if (!HELIUS_API_KEY) {
    console.error("FATAL: HELIUS_API_KEY environment variable is missing.");
}
if (!PLATFORM_WEBHOOK_ID) {
    console.error("FATAL: PLATFORM_HELIUS_WEBHOOK_ID environment variable is missing.");
    // Exiting might be too harsh in a serverless context, but log severity
}

// URL for the webhook receiver function (NEEDS YOUR PROJECT REF)
const SUPABASE_PROJECT_REF = Deno.env.get('PROJECT_REF'); // Consider adding PROJECT_REF to secrets/env
if (!SUPABASE_PROJECT_REF) {
    console.error("FATAL: PROJECT_REF environment variable is missing. Cannot construct webhook receiver URL.");
}
const WEBHOOK_RECEIVER_URL_BASE = SUPABASE_PROJECT_REF
    ? `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/helius-webhook-receiver`
    : ''; // Set a default or handle error if REF is missing


// --- Supabase Admin Client ---
const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Use Service Role Key!
);

// --- User Auth Helper ---
async function getUser(req: Request): Promise<{ user: any | null; error: string | null }> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
        return { user: null, error: 'Missing Authorization Header' };
    }
    try {
        // Use Supabase client configured with anon key and passed header to validate JWT
        const { data: { user }, error } = await createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        ).auth.getUser();

        if (error) throw error; // Throw Supabase auth errors
        if (!user) throw new Error('User not found for the provided token'); // Should not happen if token valid but good check
        return { user, error: null };

    } catch (error: unknown) { // Catch unknown type
        console.error('Auth error during getUser:', error);
        // Return a generic error message for security
        return { user: null, error: 'Invalid or expired Authentication Token' };
    }
}

// --- Helper to get all unique active addresses from jobs ---
async function getAllActiveAddresses(excludeJobId?: string): Promise<string[]> {
    console.log(`Workspaceing all active addresses ${excludeJobId ? 'excluding job ' + excludeJobId : ''}`);
    const query = supabaseAdmin
        .from('indexing_jobs')
        .select('id, data_category, category_params')
        .eq('status', 'active'); // Only consider active jobs

    // Optionally filter out the job being deleted
    if (excludeJobId) {
         query.not('id', 'eq', excludeJobId);
    }

    const { data: activeJobs, error } = await query;

    if (error) {
        console.error("Error fetching active job addresses:", error);
        throw new Error(`Could not fetch active job configurations: ${error.message}`);
    }

    const addressSet = new Set<string>();
    activeJobs?.forEach(job => {
        let address: string | null = null;
        // Extract the relevant address based on the category
        switch (job.data_category) {
            case 'MINT_ACTIVITY':
                address = job.category_params?.mintAddress;
                break;
            case 'PROGRAM_INTERACTIONS':
                address = job.category_params?.programId;
                break;
            // Add other categories as needed
        }
        // Add to set only if it's a non-empty string
        if (address && typeof address === 'string' && address.trim() !== '') {
            addressSet.add(address.trim());
        } else {
             console.warn(`Job ${job.id} has missing or invalid address parameter for category ${job.data_category}`);
        }
    });
     console.log(`Found ${addressSet.size} unique active addresses.`);
    return Array.from(addressSet);
}

// --- Helper to Edit Helius Webhook ---
async function editPlatformWebhook(accountAddresses: string[]): Promise<void> {
     if (!HELIUS_API_KEY || !PLATFORM_WEBHOOK_ID) {
         console.error("Cannot edit webhook: Platform Helius config missing (API Key or Webhook ID)");
         throw new Error('Platform Helius config missing');
     }
    const editUrl = `${HELIUS_API_BASE_URL}/${PLATFORM_WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`;

    // Ensure webhook receiver URL is configured
    if (!WEBHOOK_RECEIVER_URL_BASE) {
         console.error("Cannot edit webhook: WEBHOOK_RECEIVER_URL_BASE is not configured.");
         throw new Error('Webhook receiver URL is not configured.');
    }

    // Construct the payload carefully based on Helius PUT requirements
    // It's often best to include all fields you want to persist
    const payload = {
        webhookURL: WEBHOOK_RECEIVER_URL_BASE, // Ensure this points to your receiver
        transactionTypes: ["ANY"], // Assuming we always want all types for simplicity
        accountAddresses: [...new Set(accountAddresses)], // Ensure unique addresses
        webhookType: "enhanced", // Assuming enhanced, adjust if needed
        txnStatus: "all", // Usually 'all', 'success', or 'failed'
        // authHeader: undefined, // Set if you want to use auth headers on received webhooks
    };

    console.log(`Editing platform webhook ${PLATFORM_WEBHOOK_ID} with ${payload.accountAddresses.length} addresses.`);
    // Avoid logging the full address list if it's very large
    // console.log("Address list sample:", payload.accountAddresses.slice(0, 5));

    const response = await fetch(editUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        let errorData: any = {};
        try {
             errorData = await response.json();
        } catch (e) {
             // If response is not JSON, use text
             errorData.error = await response.text();
        }
        console.error("Helius API Error (Edit):", response.status, response.statusText, errorData);
        throw new Error(errorData?.error || `Helius API edit request failed with status ${response.status}`);
    }
    console.log(`Platform webhook ${PLATFORM_WEBHOOK_ID} edited successfully.`);
}

// --- Main Request Handler ---
serve(async (req: Request) => {
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // Authenticate User
    const { user, error: authError } = await getUser(req);
    if (authError || !user) {
        console.warn('Auth failed:', authError);
        return new Response(JSON.stringify({ error: authError || 'Authentication required' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Prepare response headers
    let responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    // Parse URL for ID
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(part => part);
    const functionNameIndex = pathParts.findIndex(p => p === 'manage-jobs');
    const resourceId = functionNameIndex !== -1 && pathParts.length > functionNameIndex + 1 ? pathParts[functionNameIndex + 1] : null;

    try {
        // Enhanced Body Parsing for POST/PUT/PATCH
        let body: any = null; // Initialize body for non-body methods too
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
             const contentType = req.headers.get('content-type');
             console.log(`Received ${req.method} request for user ${user.id}. Content-Type: ${contentType}`);

             // Read body as text first for logging
             const rawBody = await req.text();
             console.log("Raw request body received:", rawBody || '<Empty>'); // Log the exact text received

             if (!rawBody) {
                 console.error("Request body is empty.");
                 // Consider if empty body is valid for some PUT/PATCH? For POST, usually not.
                 if (req.method === 'POST') {
                     return new Response(JSON.stringify({ error: 'Request body cannot be empty for POST' }), { status: 400, headers: responseHeaders });
                 }
                 // Allow potentially empty body for PUT/PATCH for now, validation happens later
             } else {
                  try {
                      body = JSON.parse(rawBody); // Parse the text body
                      console.log("Parsed body:", body); // Log after successful parse
                  } catch (parseError: unknown) {
                      console.error("JSON parsing failed:", parseError);
                      let message = (parseError instanceof Error) ? parseError.message : 'Unknown parsing error';
                      throw new Error(`Invalid JSON payload: ${message}`); // Throw specific error for catch block
                  }
             }
        }

        // --- Route based on Method ---
        switch (req.method) {
            // --- GET /manage-jobs ---
            case 'GET': {
                if (resourceId) { // Don't allow GET /:id for this function
                       return new Response(JSON.stringify({ error: 'Method Not Allowed for this path' }), { status: 405, headers: responseHeaders });
                }
                console.log(`GET jobs request for user ${user.id}`);
                const { data, error } = await supabaseAdmin
                    .from('indexing_jobs')
                    .select(`
                        id, data_category, category_params, target_table_name, status, created_at, last_event_at, error_message,
                        db_credentials ( id, alias, host )
                    `) // Select specific fields from joined table
                    .eq('user_id', user.id) // Filter for the authenticated user
                    .order('created_at', { ascending: false });

                if (error) {
                     console.error("Error fetching jobs:", error);
                     throw new Error(`Database error fetching jobs: ${error.message}`); // More specific error
                }
                return new Response(JSON.stringify(data ?? []), {
                    headers: responseHeaders, status: 200,
                });
            }

            // --- POST /manage-jobs (Create Job) ---
            case 'POST': {
                if (resourceId) { // Don't allow POST /:id
                    return new Response(JSON.stringify({ error: 'Method Not Allowed for this path' }), { status: 405, headers: responseHeaders });
                }
                console.log(`Processing POST job request for user ${user.id}`);

                // Use the 'body' variable parsed above
                if (!body) { throw new Error("Request body is required for POST but was missing or failed to parse."); }

                // 1. Validate Input & Credential Ownership
                if (!body.credential_id || !body.data_category || !body.target_table_name || !body.category_params) {
                   return new Response(JSON.stringify({ error: 'Missing required fields (credential_id, data_category, target_table_name, category_params)' }), { status: 400, headers: responseHeaders });
                }
                 // Verify credential ownership
                 const { data: credCheck, error: credError } = await supabaseAdmin
                    .from('db_credentials')
                    .select('id')
                    .eq('id', body.credential_id)
                    .eq('user_id', user.id) // Check ownership
                    .maybeSingle();

                 if (credError) {
                      console.error("DB error checking credential ownership:", credError);
                      throw new Error(`Database error verifying credential: ${credError.message}`);
                 }
                 if (!credCheck) {
                     console.warn(`User ${user.id} attempted to use credential ${body.credential_id} they do not own.`);
                     return new Response(JSON.stringify({ error: 'Invalid or inaccessible credential ID' }), { status: 403, headers: responseHeaders }); // Forbidden
                 }

                // 2. Determine new job address & Validate params
                let newJobAddress: string | null = null;
                switch (body.data_category) {
                     case 'MINT_ACTIVITY':
                          newJobAddress = body.category_params?.mintAddress;
                          if (!newJobAddress || typeof newJobAddress !== 'string' || newJobAddress.trim() === '') {
                              return new Response(JSON.stringify({ error: 'Missing or invalid mintAddress in category_params for MINT_ACTIVITY' }), { status: 400, headers: responseHeaders });
                          }
                          break;
                     case 'PROGRAM_INTERACTIONS':
                          newJobAddress = body.category_params?.programId;
                           if (!newJobAddress || typeof newJobAddress !== 'string' || newJobAddress.trim() === '') {
                              return new Response(JSON.stringify({ error: 'Missing or invalid programId in category_params for PROGRAM_INTERACTIONS' }), { status: 400, headers: responseHeaders });
                          }
                          break;
                     default:
                          return new Response(JSON.stringify({ error: `Unsupported data_category: ${body.data_category}` }), { status: 400, headers: responseHeaders });
                }
                newJobAddress = newJobAddress.trim(); // Ensure trimmed

                // 3. Get all currently active addresses (across all users)
                const currentActiveAddresses = await getAllActiveAddresses();

                // 4. Add the new address (if not already present)
                const newAddressSet = new Set(currentActiveAddresses);
                newAddressSet.add(newJobAddress);
                const updatedAddressList = Array.from(newAddressSet);

                // 5. Edit the Platform Webhook *before* saving the job
                await editPlatformWebhook(updatedAddressList);

                // 6. Save Job to Supabase DB
                 const newJobData = {
                    user_id: user.id,
                    credential_id: body.credential_id,
                    data_category: body.data_category,
                    category_params: body.category_params,
                    target_table_name: body.target_table_name,
                    status: 'active', // Start active
                    // Note: We don't store helius_webhook_id or internal_hook_id per job anymore
                };
                const { data: savedJob, error: insertError } = await supabaseAdmin
                    .from('indexing_jobs')
                    .insert(newJobData)
                    .select(`*, db_credentials ( id, alias, host )`) // Re-fetch joined data
                    .single();

                 if (insertError) {
                     console.error(`CRITICAL: Failed to save job for address ${newJobAddress} to DB after successfully editing Helius webhook ${PLATFORM_WEBHOOK_ID}. Attempting rollback. DB Error:`, insertError);
                     // Attempt to roll back Helius webhook edit
                     try {
                        await editPlatformWebhook(currentActiveAddresses); // Revert to previous address list
                        console.warn(`Helius webhook ${PLATFORM_WEBHOOK_ID} potentially rolled back to previous state.`);
                     } catch (rollbackError) {
                        console.error(`CRITICAL: Failed to roll back Helius webhook ${PLATFORM_WEBHOOK_ID} after DB insert error. Manual Helius cleanup needed! Rollback Error:`, rollbackError);
                     }
                     throw new Error(`Failed to save job to database: ${insertError.message}`);
                 }

                console.log(`Job ${savedJob.id} created successfully for user ${user.id}`);
                return new Response(JSON.stringify(savedJob), {
                  headers: responseHeaders, status: 201, // Created
                });
            }

            // --- DELETE /manage-jobs/{id} ---
            case 'DELETE': {
                if (!resourceId) {
                    return new Response(JSON.stringify({ error: 'Job ID required in path' }), { status: 400, headers: responseHeaders });
                }
                console.log(`Processing DELETE job ${resourceId} request by user ${user.id}`);

                // 1. Fetch Job to delete & Verify Ownership
                 const { data: jobToDelete, error: fetchError } = await supabaseAdmin
                    .from('indexing_jobs')
                    .select('id, user_id, data_category, category_params, status') // Need params to know which address to remove
                    .eq('id', resourceId)
                    .single();

                 if (fetchError) {
                      console.error(`Error fetching job ${resourceId} for delete:`, fetchError);
                      // Handle potentially "not found" specifically
                      if (fetchError.code === 'PGRST116') { // PostgREST code for "Not Found"
                         return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: responseHeaders });
                      }
                      throw new Error(`Database error fetching job: ${fetchError.message}`);
                 }
                 if (!jobToDelete) { // Should be covered by fetchError but belt-and-suspenders
                     return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: responseHeaders });
                 }
                 if (jobToDelete.user_id !== user.id) {
                      console.warn(`User ${user.id} attempted to delete job ${resourceId} owned by ${jobToDelete.user_id}`);
                      return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: responseHeaders }); // Forbidden
                 }

                // 2. Determine the address associated with the job being deleted
                let deletedJobAddress: string | null = null;
                 switch (jobToDelete.data_category) {
                    case 'MINT_ACTIVITY': deletedJobAddress = jobToDelete.category_params?.mintAddress; break;
                    case 'PROGRAM_INTERACTIONS': deletedJobAddress = jobToDelete.category_params?.programId; break;
                    // Add other categories
                 }
                 deletedJobAddress = deletedJobAddress?.trim() || null; // Ensure trimmed

                // 3. Get all addresses needed for *other* active jobs
                const remainingActiveAddresses = await getAllActiveAddresses(resourceId); // Exclude the job being deleted

                // 4. Edit the Platform Webhook only if the address list needs changing
                 const isAddressStillNeeded = deletedJobAddress ? remainingActiveAddresses.includes(deletedJobAddress) : false;

                 if (deletedJobAddress && !isAddressStillNeeded) {
                     // Only edit the webhook if the address list actually needs shrinking
                     console.log(`Address ${deletedJobAddress} is no longer needed by other active jobs, editing webhook ${PLATFORM_WEBHOOK_ID}.`);
                     try {
                        await editPlatformWebhook(remainingActiveAddresses);
                     } catch (editError: unknown) {
                         const errorMsg = (editError instanceof Error) ? editError.message : 'Unknown Helius Error';
                         console.error(`ERROR: Failed to edit Helius webhook ${PLATFORM_WEBHOOK_ID} during job ${resourceId} deletion. Proceeding with DB deletion, but webhook may need manual check. Edit Error:`, errorMsg);
                         // Log this but proceed with DB deletion - better to remove the job config than leave everything inconsistent
                     }
                 } else {
                      console.log(`Address ${deletedJobAddress} is still needed or wasn't found. No webhook edit needed for job ${resourceId} deletion.`);
                 }

                // 5. Delete Job from Supabase DB
                const { error: deleteDbError } = await supabaseAdmin
                    .from('indexing_jobs')
                    .delete()
                    .eq('id', resourceId); // Use primary key

                if (deleteDbError) {
                    console.error(`Failed to delete job ${resourceId} from DB:`, deleteDbError);
                    throw new Error(`Database error deleting job: ${deleteDbError.message}`);
                }

                console.log(`Job ${resourceId} deleted successfully for user ${user.id}`);
                return new Response(null, { headers: corsHeaders, status: 204 }); // No Content
            }

            // --- Default: Method Not Allowed ---
            default:
                console.warn(`Received request with unhandled method: ${req.method}`);
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                    status: 405,
                    headers: responseHeaders,
                });
        }
    } catch (err: unknown) { // Catch errors from overall processing (outside parsing)
        console.error('Error in manage-jobs main handler:', err);
        const errorMessage = (err instanceof Error) ? err.message : 'Internal Server Error';
        // Determine status code based on error message content if possible
        let status = 500; // Default Internal Server Error
        if (errorMessage.includes('Database error') || errorMessage.includes('constraint')) status = 500; // Or maybe 409 for constraint?
        else if (errorMessage.includes('Helius API') || errorMessage.includes('Helius config')) status = 502; // Bad Gateway
        else if (errorMessage.includes('Invalid JSON payload')) status = 400; // Bad Request
        else if (errorMessage.includes('credential ID')) status = 403; // Forbidden

        return new Response(JSON.stringify({ error: errorMessage }), {
            status: status,
            headers: responseHeaders,
        });
    }
}); // End of serve