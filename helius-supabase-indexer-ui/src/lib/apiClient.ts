// src/lib/apiClient.ts
import { supabase } from './supabaseClient';

// --- Types --- (Keep all type definitions as before)
export type Credential = {
    id: string;
    alias: string | null;
    host: string;
    port: number;
    db_name: string;
    username: string;
    ssl_mode: string | null;
    created_at: string;
};
export type NewCredentialData = Omit<Credential, 'id' | 'created_at'> & { password?: string };
export type TestConnectionResult = {
    success: boolean;
    message: string;
};
type JobCredentialInfo = {
    id: string;
    alias: string | null;
    host: string;
};
export type IndexingJob = {
    id: string;
    data_category: string;
    category_params: Record<string, any>;
    target_table_name: string;
    status: 'active' | 'paused' | 'error' | 'pending';
    created_at: string;
    last_event_at: string | null;
    error_message: string | null;
    db_credentials: JobCredentialInfo | null;
};
export type NewJobData = {
    credential_id: string;
    data_category: string;
    category_params: Record<string, any>;
    target_table_name: string;
};


// --- Configuration & Helper ---

const getSupabaseConfig = () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        throw new Error("Supabase URL or Anon Key missing from environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)");
    }
    return { supabaseUrl, anonKey };
};

// Helper to get required headers for authenticated function calls
async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
        throw new Error(sessionError?.message || 'User not authenticated');
    }
    const { anonKey } = getSupabaseConfig();
    return {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey
    };
}

// Helper to handle fetch responses and errors
async function handleFetchResponse<T>(response: Response): Promise<T> {
    const responseBody = await response.text(); // Get body text for logging/parsing
    console.log(`[Direct Fetch] Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
        console.error(`[Direct Fetch] Error Body: ${responseBody}`);
        let specificError = `Request failed with status ${response.status}: ${response.statusText}`;
        try {
             const parsed = JSON.parse(responseBody);
             if(parsed.error) specificError = parsed.error;
        } catch(e){
            console.warn("[Direct Fetch] Response body was not valid JSON:", e);
            if (responseBody) { // Use snippet if body exists but isn't json
                specificError = responseBody.substring(0, 200) + (responseBody.length > 200 ? '...' : '');
            }
        }
        throw new Error(specificError);
    }

    // Handle 204 No Content specifically (for DELETE requests)
    if (response.status === 204) {
         return undefined as T; // Return undefined for void promises
    }

    try {
        const data = JSON.parse(responseBody); // Parse successful response
        return data as T;
    } catch (e: unknown) {
         console.error("[Direct Fetch] Failed to parse successful response JSON:", e, "Body:", responseBody);
         if (e instanceof Error) {
            throw new Error(`Failed to parse response JSON: ${e.message}`);
         }
         throw new Error("Failed to parse response JSON.");
    }
}


// --- API functions (Credentials - All using Direct Fetch) ---

export const getCredentialsDirectFetch = async (): Promise<Credential[]> => {
    console.log("[apiClient.getCredentialsDirectFetch] Requesting GET");
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-credentials`;

    const response = await fetch(functionUrl, {
        method: 'GET',
        headers: headers,
    });
    return handleFetchResponse<Credential[]>(response);
};

export async function addCredentialDirectFetch(credentialData: NewCredentialData): Promise<Credential> {
    console.log("[apiClient.addCredentialDirectFetch] Requesting POST");
    if (!credentialData.host || !credentialData.port || !credentialData.db_name || !credentialData.username || !credentialData.password) {
        return Promise.reject(new Error('Missing required credential fields'));
    }
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-credentials`;
    const requestBody = JSON.stringify(credentialData);

    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: requestBody
    });
    return handleFetchResponse<Credential>(response);
}

export const deleteCredentialDirectFetch = async (id: string): Promise<void> => {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
         return Promise.reject(new Error('Invalid ID format for delete'));
    }
    console.log(`[apiClient.deleteCredentialDirectFetch] Requesting DELETE for ${id}`);
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-credentials/${id}`; // ID in path

    const response = await fetch(functionUrl, {
        method: 'DELETE',
        headers: headers,
    });
     // Expect 204 No Content on success, handleFetchResponse handles this
    await handleFetchResponse<void>(response);
};

export const testConnectionDirectFetch = async (id: string): Promise<TestConnectionResult> => {
     if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
         return Promise.reject(new Error('Invalid ID format for test'));
    }
     console.log(`[apiClient.testConnectionDirectFetch] Requesting POST test for ${id}`);
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-credentials/test`; // Uses /test path
    const requestBody = JSON.stringify({ id });

    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: requestBody
    });
    // Test endpoint returns JSON body on both success (200) and failure (400)
    return handleFetchResponse<TestConnectionResult>(response);
};


// --- API functions (Jobs - All using Direct Fetch) ---

export const getJobsDirectFetch = async (): Promise<IndexingJob[]> => {
    console.log("[apiClient.getJobsDirectFetch] Requesting GET");
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-jobs`;

    const response = await fetch(functionUrl, {
        method: 'GET',
        headers: headers,
    });
    return handleFetchResponse<IndexingJob[]>(response);
};

export const addJobDirectFetch = async (jobData: NewJobData): Promise<IndexingJob> => {
     console.log("[apiClient.addJobDirectFetch] Requesting POST");
    // Validation...
    if (!jobData.credential_id || !jobData.data_category || !jobData.target_table_name || !jobData.category_params) {
        return Promise.reject(new Error('Missing required fields for new job'));
    }
    if (jobData.data_category === 'MINT_ACTIVITY' && !jobData.category_params?.mintAddress) {
        return Promise.reject(new Error('Missing mintAddress for MINT_ACTIVITY'));
    }
    if (jobData.data_category === 'PROGRAM_INTERACTIONS' && !jobData.category_params?.programId) {
        return Promise.reject(new Error('Missing programId for PROGRAM_INTERACTIONS'));
    }
    // ... add validation for other categories ...

    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-jobs`;
    const requestBody = JSON.stringify(jobData);

    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: requestBody
    });
    return handleFetchResponse<IndexingJob>(response);
};

export const deleteJobDirectFetch = async (id: string): Promise<void> => {
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)) {
       return Promise.reject(new Error('Invalid ID format for delete job'));
    }
    console.log(`[apiClient.deleteJobDirectFetch] Requesting DELETE for job ${id}`);
    const { supabaseUrl } = getSupabaseConfig();
    const headers = await getAuthHeaders();
    const functionUrl = `${supabaseUrl}/functions/v1/manage-jobs/${id}`; // ID in path

    const response = await fetch(functionUrl, {
        method: 'DELETE',
        headers: headers,
    });
     // Expect 204 No Content on success
    await handleFetchResponse<void>(response);
};
