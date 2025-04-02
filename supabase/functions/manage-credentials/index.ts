// supabase/functions/manage-credentials/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
// --- Import Deno Postgres Client ---
import { Client as PostgresClient } from "https://deno.land/x/postgres@v0.17.0/mod.ts"; // Use deno-postgres
// ------------------------------------
import { corsHeaders } from '../_shared/cors.ts'; // Assuming cors.ts helper exists
import { encrypt, decrypt } from '../_shared/crypto.ts'; // Use the Deno version consistent with saving

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
        if (!user) throw new Error('User not found for the provided token');
        return { user, error: null };

    } catch (error: unknown) { // Catch unknown type
        console.error('Auth error during getUser:', error);
        // Return a generic error message for security
        return { user: null, error: 'Invalid or expired Authentication Token' };
    }
}

// --- Main Request Handler ---
serve(async (req: Request) => {
    // Handle CORS preflight requests first
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    // Authenticate User for all other methods
    const { user, error: authError } = await getUser(req);
    if (authError || !user) {
        console.warn('Auth failed:', authError);
        return new Response(JSON.stringify({ error: authError || 'Authentication required' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Prepare default response headers
    let responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

    // Parse URL to determine path and potential resource ID
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(part => part); // Filter out empty strings
    const functionNameIndex = pathParts.findIndex(p => p === 'manage-credentials');
    let resourceId: string | null = null;
    let isTest = false;

    // Check for patterns like /manage-credentials/{id} or /manage-credentials/test
    if (functionNameIndex !== -1 && pathParts.length > functionNameIndex + 1) {
        const nextPart = pathParts[functionNameIndex + 1];
        if (nextPart === 'test') {
            isTest = true;
        } else {
            // Assume it's an ID (could add UUID validation later if needed)
            resourceId = nextPart;
        }
    }

    try {
        let body: any = null; // Initialize body
        // Parse body only for relevant methods (POST, PUT, PATCH)
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
             const contentType = req.headers.get('content-type');
             const rawBody = await req.text();
             console.log(`Received ${req.method} for user ${user.id}. Path: ${url.pathname}. Raw Body: ${rawBody || '<Empty>'}`);

             if (!rawBody && req.method === 'POST' && !isTest) {
                 // Body required for creating a credential
                 return new Response(JSON.stringify({ error: 'Request body cannot be empty for creating credential' }), { status: 400, headers: responseHeaders });
             } else if (rawBody) {
                // Attempt to parse if body is not empty
                try {
                    if (contentType && contentType.includes('application/json')) {
                        body = JSON.parse(rawBody);
                        console.log("Parsed body:", body);
                    } else {
                         console.warn("Content-Type not application/json, attempting JSON parse anyway.");
                         body = JSON.parse(rawBody); // Still try, might fail
                         console.log("Parsed non-JSON body attempt:", body);
                    }
                } catch (parseError: unknown) {
                    console.error("JSON parsing failed:", parseError);
                    const message = (parseError instanceof Error) ? parseError.message : 'Unknown parsing error';
                    // Throw specific error for invalid JSON
                    throw new Error(`Invalid JSON payload: ${message}`);
                }
             }
        } // End body parsing block

        // --- Route based on Method ---
        switch (req.method) {
            // --- GET /manage-credentials ---
            case 'GET': {
                 // Path should be exactly /manage-credentials, no ID or /test allowed for GET
                 if (resourceId || isTest) {
                     return new Response(JSON.stringify({ error: 'Method Not Allowed for this specific path' }), { status: 405, headers: responseHeaders });
                 }
                console.log(`GET credentials request for user ${user.id}`);
                // Fetch credentials owned by the authenticated user
                // RLS *should* be handled by user context in theory, but service key bypasses. Filter explicitly.
                const { data, error } = await supabaseAdmin
                  .from('db_credentials')
                  .select('id, alias, host, port, db_name, username, ssl_mode, created_at') // Exclude encrypted_password
                  .eq('user_id', user.id) // Explicitly filter by user ID
                  .order('created_at', { ascending: true });

                if (error) {
                     console.error("Error fetching credentials:", error);
                     throw new Error(`Database error fetching credentials: ${error.message}`);
                }
                console.log(`Found ${data?.length ?? 0} credentials for user ${user.id}`);
                return new Response(JSON.stringify(data ?? []), { // Ensure it's an array
                  headers: responseHeaders, status: 200,
                });
            }

            // --- DELETE /manage-credentials/{id} ---
            case 'DELETE': {
                 // Path must include an ID, /test is not valid for DELETE
                 if (!resourceId || isTest) {
                     return new Response(JSON.stringify({ error: 'Credential ID required in path for DELETE' }), { status: 400, headers: responseHeaders });
                 }
                console.log(`Processing DELETE credential ${resourceId} request by user ${user.id}`);

                // Delete from Supabase, checking ownership implicitly via RLS (if active) or explicitly
                const { error, count } = await supabaseAdmin
                  .from('db_credentials')
                  .delete({ count: 'exact' }) // Get count of deleted rows
                  .eq('id', resourceId)
                  .eq('user_id', user.id); // Explicit ownership check for safety

                if (error) {
                    console.error(`Error deleting credential ${resourceId}:`, error);
                    throw new Error(`Database error deleting credential: ${error.message}`);
                }

                if (count === 0) {
                     console.warn(`Credential ${resourceId} not found or user ${user.id} lacks permission.`);
                     // Return 404 Not Found
                     return new Response(JSON.stringify({ error: 'Credential not found or access denied' }), { status: 404, headers: responseHeaders });
                }

                 console.log(`Successfully deleted credential ${resourceId} for user ${user.id}`);
                 // Return 204 No Content on successful deletion
                return new Response(null, { headers: corsHeaders, status: 204 });
            }

            // --- POST /manage-credentials OR /manage-credentials/test ---
            case 'POST': {
                // --- Test Connection Logic ---
                if (isTest) {
                    if (!body || !body.id) { // Test endpoint expects {"id": "..."} in body
                        return new Response(JSON.stringify({ error: 'Credential ID required in request body for testing' }), { status: 400, headers: responseHeaders });
                    }
                    const credentialId = body.id;
                    console.log(`TEST connection request for credential ${credentialId} by user ${user.id}`);

                    // 1. Fetch credential details, checking ownership
                    const { data: cred, error: fetchError } = await supabaseAdmin
                        .from('db_credentials')
                        .select('*')
                        .eq('id', credentialId)
                        .eq('user_id', user.id) // Ensure ownership
                        .single();

                    if (fetchError || !cred) {
                        console.error('Test connection fetch error:', fetchError);
                        const msg = fetchError?.code === 'PGRST116' ? 'Credential not found' : 'Access denied or DB error';
                        return new Response(JSON.stringify({ error: `${msg}` }), { status: 404, headers: responseHeaders });
                    }

                    // 2. Decrypt password
                    let decryptedPassword;
                    try {
                        decryptedPassword = await decrypt(cred.encrypted_password); // Uses Deno crypto from _shared
                    } catch (decryptError: unknown) {
                         console.error(`Decryption failed for credential ${credentialId}:`, decryptError);
                         const errorMsg = decryptError instanceof Error ? decryptError.message : "Decryption Error";
                         return new Response(JSON.stringify({ error: `Failed to decrypt password for testing: ${errorMsg}` }), { status: 500, headers: responseHeaders });
                    }

                    // 3. Attempt connection using deno-postgres
                    let pgClient: PostgresClient | null = null;
                    let connectionSuccess = false;
                    let connectionErrorMsg = 'Failed to connect';

                    try {
                        console.log(`Attempting connection via deno-postgres to ${cred.host}:${cred.port} as ${cred.username}`);
                        pgClient = new PostgresClient({
                            user: cred.username,
                            password: decryptedPassword,
                            database: cred.db_name,
                            hostname: cred.host,
                            port: cred.port,
                            connection: {
                                tls: { enabled: cred.ssl_mode === 'require' || cred.ssl_mode === 'prefer' || cred.ssl_mode === 'allow' }
                            },
                            // Consider adding connection timeout setting from deno-postgres options
                        });
                        await pgClient.connect();
                        await pgClient.queryObject('SELECT 1'); // Simple test query
                        connectionSuccess = true;
                        console.log(`Connection test successful for ${credentialId}`);
                    } catch (err: unknown) {
                        // Handle connection errors
                         console.error(`Connection test FAILED for ${credentialId} using deno-postgres:`, err);
                         connectionErrorMsg = err instanceof Error ? err.message : 'Unknown connection error';
                         // Refine common errors
                         if (connectionErrorMsg.includes('authentication failed')) connectionErrorMsg = 'Authentication failed. Check username/password.';
                         if (connectionErrorMsg.includes('database') && connectionErrorMsg.includes('does not exist')) connectionErrorMsg = 'Database does not exist.';
                         if (connectionErrorMsg.includes('tls') || connectionErrorMsg.includes('ssl')) connectionErrorMsg = `TLS/SSL connection error: ${connectionErrorMsg}`;
                         if (connectionErrorMsg.includes('timed out') || connectionErrorMsg.includes('dns') || connectionErrorMsg.includes('address')) connectionErrorMsg = `Connection timed out or host not found (${cred.host}). Check host/port/network.`;
                    } finally {
                        // Ensure connection is closed
                        if (pgClient) {
                            try { await pgClient.end(); console.log(`Closed test connection for ${credentialId}`); }
                            catch (endError) { console.error(`Error closing test connection for ${credentialId}:`, endError); }
                        }
                    }

                    // 4. Return result
                    const status = connectionSuccess ? 200 : 400; // OK or Bad Request
                    return new Response(JSON.stringify({ success: connectionSuccess, message: connectionSuccess ? 'Connection successful!' : connectionErrorMsg }), {
                       headers: responseHeaders, status: status });

                } // End if (isTest)

                // --- Create Credential Logic ---
                else {
                     if (resourceId) { // Don't allow POST /:id for create
                         return new Response(JSON.stringify({ error: 'Method Not Allowed for this path' }), { status: 405, headers: responseHeaders });
                     }
                     console.log(`Processing CREATE credential request for user ${user.id}`);
                     if (!body) { throw new Error("Request body required to create credential."); } // Should be caught by earlier check, but safety

                     // Validate required fields from body
                     if (!body.host || !body.port || !body.db_name || !body.username || !body.password) {
                       return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: responseHeaders });
                     }
                     if (typeof body.password !== 'string' || body.password.length === 0) {
                        return new Response(JSON.stringify({ error: 'Password cannot be empty' }), { status: 400, headers: responseHeaders });
                     }

                     // Encrypt password (uses Deno crypto from _shared/crypto.ts)
                     const encryptedPassword = await encrypt(body.password);

                     const newCredential = {
                       user_id: user.id,
                       alias: body.alias || null,
                       host: body.host,
                       port: parseInt(body.port, 10),
                       db_name: body.db_name,
                       username: body.username,
                       encrypted_password: encryptedPassword, // Uses consistent format now
                       ssl_mode: body.ssl_mode || 'prefer',
                     };

                     // Insert into Supabase
                     const { data: savedCred, error: insertError } = await supabaseAdmin
                         .from('db_credentials')
                         .insert(newCredential)
                         .select('id, alias, host, port, db_name, username, ssl_mode, created_at')
                         .single(); // Expect one row back

                     if (insertError) {
                         console.error('Insert credential error:', insertError);
                          if (insertError.code === '23505') { // Unique constraint violation
                             return new Response(JSON.stringify({ error: 'Failed to save: Duplicate credential?' }), { status: 409, headers: responseHeaders }); // Conflict
                          }
                          if (insertError.message.includes('check constraint')) { // e.g., port out of range
                             return new Response(JSON.stringify({ error: `Invalid input: ${insertError.message}` }), { status: 400, headers: responseHeaders }); // Bad Request
                          }
                         throw new Error(`Database error saving credential: ${insertError.message}`); // Other DB errors
                     }

                     console.log(`Successfully created credential ${savedCred.id} for user ${user.id}`);
                     return new Response(JSON.stringify(savedCred), { headers: responseHeaders, status: 201 }); // 201 Created
                } // End else (is Create Credential)
            } // End case POST

            // --- Default: Method Not Allowed ---
            default:
                console.warn(`Received request with unhandled method: ${req.method} for path ${url.pathname}`);
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                    status: 405, // Method Not Allowed
                    headers: responseHeaders,
                });
        } // End Switch

    } catch (err: unknown) { // Catch errors from overall processing (parsing, unexpected)
        console.error('Error in manage-credentials main handler:', err);
        const errorMessage = (err instanceof Error) ? err.message : 'Internal Server Error';
        // Determine status code based on error type if possible, else default 500
         const status = (err instanceof SyntaxError || errorMessage.startsWith('Invalid JSON payload')) ? 400 // Bad Request for JSON errors
                        : (errorMessage.includes('credential ID') ? 403 // Forbidden if cred check fails (though handled above)
                         : 500); // Default Internal Server Error

        return new Response(JSON.stringify({ error: errorMessage }), {
          status: status,
          headers: responseHeaders,
        });
    }
}); // End Serve