// src/pages/JobsPage.tsx
import React, { useState, useEffect, useCallback, ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
// Import the direct fetch function names and types
import {
    getJobsDirectFetch,
    deleteJobDirectFetch,
    addJobDirectFetch,
    getCredentialsDirectFetch, // Need credentials for the form dropdown
    IndexingJob,
    NewJobData,
    Credential // Use the Credential type for the dropdown
} from '../lib/apiClient';

// --- Component Prop Types ---
interface JobListProps {
    jobs: IndexingJob[];
    onDelete: (id: string) => void;
    deleteStatus: Record<string, { status: 'deleting' | 'error' }>;
}

interface AddJobFormProps {
    credentials: Credential[]; // Pass available credentials
    onSubmit: (data: NewJobData) => Promise<void>;
    isSaving: boolean;
    error: string | null;
    onCancel: () => void;
}

// --- Helper: Simple Spinner ---
const Spinner = () => (
  <svg className="animate-spin inline-block h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

// --- Main Page Component ---
const JobsPage: React.FC = () => {
    const [jobs, setJobs] = useState<IndexingJob[]>([]);
    const [credentials, setCredentials] = useState<Credential[]>([]); // For the form
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [pageError, setPageError] = useState<string | null>(null); // Page-level errors
    const [showAddForm, setShowAddForm] = useState<boolean>(false);

    // State for tracking delete operations status per job ID
    const [deleteStatus, setDeleteStatus] = useState<Record<string, { status: 'deleting' | 'error' }>>({});

    // State specific to the Add Job Form
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Fetch jobs and credentials
    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setPageError(null);
        try {
            // Fetch both in parallel using direct fetch functions
            const [jobsData, credentialsData] = await Promise.all([
                getJobsDirectFetch(),
                getCredentialsDirectFetch() // Fetch credentials for the AddJobForm dropdown
            ]);
            setJobs(jobsData);
            setCredentials(credentialsData);
        } catch (err: unknown) { // Use unknown
            const errorMsg = (err instanceof Error) ? err.message : 'Failed to fetch initial data.';
            setPageError(errorMsg);
            setJobs([]);
            setCredentials([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Handler for adding a new job - USE DIRECT FETCH
    const handleAddJob = async (data: NewJobData): Promise<void> => {
        setIsSaving(true);
        setSaveError(null);
        try {
            // Add validation if needed before calling API
            console.log("Attempting save using addJobDirectFetch...");
            const newJob = await addJobDirectFetch(data); // Use direct fetch version
            setJobs(prev => [newJob, ...prev]); // Add to beginning of list
            setShowAddForm(false); // Hide form on success
        } catch (err: unknown) { // Use unknown
             const errorMsg = (err instanceof Error) ? err.message : 'Failed to save job.';
            setSaveError(errorMsg);
            throw err; // Rethrow for form handling
        } finally {
            setIsSaving(false);
        }
    };

    // Handler for deleting a job - USE DIRECT FETCH
    const handleDeleteJob = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this job? This will stop indexing and attempt to update the Helius webhook.')) {
            return;
        }
        setDeleteStatus(prev => ({ ...prev, [id]: { status: 'deleting' } }));
        setPageError(null);
        try {
            await deleteJobDirectFetch(id); // Use direct fetch version
            setJobs(prev => prev.filter(job => job.id !== id)); // Remove from list
            setDeleteStatus(prev => {
                const newState = {...prev};
                delete newState[id];
                return newState;
            });
        } catch (err: unknown) { // Use unknown
            const errorMsg = (err instanceof Error) ? err.message : 'Failed to delete job.';
            setPageError(`Failed to delete job: ${errorMsg}`);
            setDeleteStatus(prev => ({ ...prev, [id]: { status: 'error' } }));
        }
    };

     // Handler for cancelling the Add form
     const handleCancelAdd = () => {
        setShowAddForm(false);
        setSaveError(null); // Clear any previous save errors
     };

    // --- Render UI ---
    return (
         <div className="min-h-screen bg-gray-100">
            {/* Navbar/Header */}
            <nav className="bg-white shadow-sm sticky top-0 z-10">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
                    <h1 className="text-xl font-semibold text-gray-800">Manage Indexing Jobs</h1>
                    <Link to="/dashboard" className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
                        &larr; Back to Dashboard
                    </Link>
                </div>
            </nav>

            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
                 {/* Page Level Error Display */}
                {pageError && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" role="alert">
                    <span className="font-bold">Error: </span>{pageError}
                  </div>
                )}

                {/* Add Job Button / Form Area */}
                <div className="mb-6 flex justify-end">
                    {!showAddForm && (
                         <button
                            onClick={() => setShowAddForm(true)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out flex items-center"
                        >
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                             <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                           </svg>
                            Create New Job
                        </button>
                    )}
                </div>

                {showAddForm && (
                    <div className="mb-8">
                         {/* Form component defined below */}
                        <AddJobForm
                            credentials={credentials} // Pass credentials to form
                            onSubmit={handleAddJob}
                            isSaving={isSaving}
                            error={saveError}
                            onCancel={handleCancelAdd}
                        />
                    </div>
                )}

                 {/* Loading State */}
                {isLoading && (
                    <div className="text-center py-10">
                        <Spinner /> <span className="ml-2 text-gray-500">Loading jobs...</span>
                    </div>
                )}

                 {/* Jobs List or Empty State */}
                {!isLoading && !pageError && (
                    <>
                        {jobs.length === 0 && !showAddForm ? (
                             <div className="text-center py-10 bg-white rounded-lg shadow">
                                <p className="text-gray-500">No indexing jobs created yet.</p>
                                <button
                                    onClick={() => setShowAddForm(true)}
                                    className="mt-4 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out"
                                >
                                    Create Your First Job
                                </button>
                             </div>
                        ) : jobs.length > 0 ? (
                             // List component defined below
                            <JobList
                                jobs={jobs}
                                onDelete={handleDeleteJob}
                                deleteStatus={deleteStatus}
                            />
                        ): null }
                    </>
                )}
            </main>
        </div>
    );
}; // End of JobsPage component


// --- Child Component: JobList ---

const JobList: React.FC<JobListProps> = ({ jobs, onDelete, deleteStatus }) => {
    if (!jobs || jobs.length === 0) {
        return null;
    }

    return (
        <div className="bg-white shadow-md rounded-lg overflow-x-auto">
             <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parameters</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Table</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Credential</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                    {jobs.map(job => {
                         const currentDeleteStatus = deleteStatus[job.id];
                         const isDeleting = currentDeleteStatus?.status === 'deleting';
                         const isDisabled = isDeleting; // Add other conditions like 'pausing' if needed

                         // Format parameters for display
                         const paramsString = job.category_params
                             ? Object.entries(job.category_params)
                                 .map(([key, value]) => `${key}: ${value}`)
                                 .join('; ')
                             : 'None';

                        return (
                             <tr key={job.id} className={`transition-opacity duration-300 ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
                                 <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{job.data_category.replace(/_/g, ' ')}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 max-w-xs truncate" title={paramsString}>{paramsString}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{job.target_table_name}</td>
                                 <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" title={job.db_credentials?.host ?? 'Unknown host'}>
                                    {job.db_credentials?.alias || <span className="text-gray-400 italic">ID: {job.db_credentials?.id?.substring(0, 8)}...</span> || 'N/A'}
                                 </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${
                                        job.status === 'active' ? 'bg-green-100 text-green-800' :
                                        job.status === 'error' ? 'bg-red-100 text-red-800' :
                                        job.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-800' // pending
                                    }`}>
                                        {job.status}
                                     </span>
                                     {/* Display error message if status is error */}
                                     {job.status === 'error' && (
                                        <p className="text-xs text-red-600 mt-1 max-w-[200px] truncate" title={job.error_message ?? ''}>
                                            {job.error_message || 'An error occurred'}
                                        </p>
                                     )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                     {/* Placeholder for View Logs - Link to where logs might be viewed */}
                                     <button disabled className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-400 cursor-not-allowed" title="View Logs (Coming Soon)">
                                         Logs
                                    </button>
                                      {/* Delete Button */}
                                      <button
                                        onClick={() => !isDisabled && onDelete(job.id)}
                                        disabled={isDisabled}
                                        className={`inline-flex items-center justify-center px-2 py-1 text-xs rounded ${
                                            isDeleting
                                                ? 'bg-gray-200 text-gray-500 cursor-wait'
                                                : 'bg-red-100 text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed'
                                        }`}
                                        title="Delete Job"
                                    >
                                         {isDeleting && <Spinner />}
                                         <span className={isDeleting ? 'ml-1.5' : ''}>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                                     </button>
                                     {currentDeleteStatus?.status === 'error' && <span className="text-xs text-red-600 font-semibold" title="Deletion failed, check page errors">Error</span> }
                                 </td>
                             </tr>
                        );
                    })}
                </tbody>
             </table>
         </div>
     );
}; // End of JobList Component


// --- Child Component: AddJobForm ---

const AddJobForm: React.FC<AddJobFormProps> = ({ credentials, onSubmit, isSaving, error, onCancel }) => {
     // Define available categories and their required parameters
     const availableCategories = [
         { value: 'MINT_ACTIVITY', label: 'Mint Activity', params: [{ name: 'mintAddress', label: 'Mint Address', placeholder: 'Enter SPL Token or NFT Mint Address' }] },
         { value: 'PROGRAM_INTERACTIONS', label: 'Program Interactions', params: [{ name: 'programId', label: 'Program ID', placeholder: 'Enter Program ID Address' }] },
         // Add more categories here as they are implemented
     ];

     const [selectedCategoryValue, setSelectedCategoryValue] = useState<string>(availableCategories[0]?.value || '');
     const [credentialId, setCredentialId] = useState<string>(credentials[0]?.id || '');
     const [targetTable, setTargetTable] = useState<string>('');
     // Use a single state object for potentially multiple parameters
     const [params, setParams] = useState<Record<string, string>>({});

     // Update params state when category changes, clearing old params
     useEffect(() => {
        setParams({}); // Reset params when category changes
     }, [selectedCategoryValue]);

     // Handle changes for dynamic parameter inputs
     const handleParamChange = (e: ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setParams(prev => ({ ...prev, [name]: value }));
     };

     // Handle form submission
     const handleSubmit = async (e: FormEvent) => {
         e.preventDefault();
         const selectedCategoryConfig = availableCategories.find(c => c.value === selectedCategoryValue);
         // Validate required fields
         if (!credentialId || !selectedCategoryValue || !targetTable || !selectedCategoryConfig) {
             alert("Please select a credential, category, and enter a target table name.");
             return;
         }
         // Validate all required params for the selected category are filled
         for (const param of selectedCategoryConfig.params) {
            if (!params[param.name]) {
                 alert(`Please enter the required parameter: ${param.label}`);
                 return;
            }
         }

         const jobData: NewJobData = {
             credential_id: credentialId,
             data_category: selectedCategoryValue,
             target_table_name: targetTable.trim(), // Trim whitespace
             category_params: params,
         };
         console.log("Submitting Job Data:", jobData);
         try {
             await onSubmit(jobData);
             // Form is hidden by parent on success
         } catch (err: unknown) {
            // Error is displayed by parent component via the 'error' prop
            console.error("Save job failed (error handled by parent):", err);
         }
     };

     const currentCategoryConfig = availableCategories.find(cat => cat.value === selectedCategoryValue);

     return (
          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md border border-gray-200 mb-6 animate-fade-in">
             <h2 className="text-xl font-semibold text-gray-700 mb-6 border-b pb-3">Create New Indexing Job</h2>
             <form onSubmit={handleSubmit} className="space-y-5">
                 {/* Display Save Error */}
                 {error && (
                  <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded" role="alert">
                    <p className="font-bold">Create Job Error</p>
                    <p>{error}</p>
                  </div>
                 )}

                 {/* Select Credential */}
                 <div>
                     <label htmlFor="credential_id" className="block text-sm font-medium text-gray-700 mb-1">Database Credential <span className="text-red-500">*</span></label>
                     <select id="credential_id" name="credential_id" value={credentialId} onChange={(e) => setCredentialId(e.target.value)} required disabled={isSaving || credentials.length === 0}
                             className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed">
                         {credentials.length === 0 && <option value="" disabled>No credentials available</option>}
                         {credentials.map(cred => (
                             <option key={cred.id} value={cred.id}>
                                 {cred.alias || `${cred.username}@${cred.host}/${cred.db_name}`} ({cred.id.substring(0,6)}...)
                             </option>
                         ))}
                     </select>
                     {credentials.length === 0 && <p className="text-xs text-red-500 mt-1">Error: No database credentials found. Please add one first.</p>}
                 </div>

                 {/* Select Category */}
                 <div>
                     <label htmlFor="data_category" className="block text-sm font-medium text-gray-700 mb-1">Data Category <span className="text-red-500">*</span></label>
                     <select id="data_category" name="data_category" value={selectedCategoryValue} onChange={(e) => setSelectedCategoryValue(e.target.value)} required disabled={isSaving}
                             className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed">
                         {availableCategories.map(cat => (
                             <option key={cat.value} value={cat.value}>{cat.label}</option>
                         ))}
                     </select>
                 </div>

                 {/* Dynamic Parameter Inputs */}
                 {currentCategoryConfig?.params.map(param => (
                    <div key={param.name}>
                        <label htmlFor={param.name} className="block text-sm font-medium text-gray-700 mb-1">{param.label} <span className="text-red-500">*</span></label>
                        <input type="text" name={param.name} id={param.name} value={params[param.name] || ''} onChange={handleParamChange} required disabled={isSaving} placeholder={param.placeholder}
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"/>
                     </div>
                 ))}

                 {/* Target Table Name */}
                <div>
                    <label htmlFor="target_table_name" className="block text-sm font-medium text-gray-700 mb-1">Target Table Name <span className="text-red-500">*</span></label>
                    <input type="text" name="target_table_name" id="target_table_name" value={targetTable} onChange={(e) => setTargetTable(e.target.value)} required disabled={isSaving} pattern="^[a-zA-Z0-9_]+$" title="Table name can only contain letters, numbers, and underscores." placeholder="e.g., solana_mint_activity"
                           className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"/>
                    <p className="mt-1 text-xs text-gray-500">Table must exist in your DB with the correct schema. Only letters, numbers, underscores allowed.</p>
                    {/* TODO: Link to schema documentation based on selected category */}
                 </div>

                 {/* Action Buttons */}
                 <div className="flex justify-end items-center space-x-3 pt-4">
                    <button type="button" onClick={onCancel} disabled={isSaving} className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="submit" disabled={isSaving || credentials.length === 0} className="inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]">
                         {isSaving && <Spinner />}
                         <span className={isSaving ? 'ml-2' : ''}>{isSaving ? 'Creating...' : 'Create Job'}</span>
                    </button>
                 </div>
             </form>
         </div>
     );
}; // End of AddJobForm Component


// Export the main page component
export default JobsPage;