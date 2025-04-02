// src/pages/CredentialsPage.tsx
import React, { useState, useEffect, useCallback, ChangeEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
// Import the direct fetch function names and types
import {
    getCredentialsDirectFetch,
    deleteCredentialDirectFetch,
    testConnectionDirectFetch,
    addCredentialDirectFetch, // <-- Using direct fetch workaround
    Credential,
    NewCredentialData
} from '../lib/apiClient'; // Import ONLY direct fetch functions now

// --- Component Prop Types ---
interface CredentialListProps {
    credentials: Credential[];
    onDelete: (id: string) => void;
    onTest: (id: string) => void;
    testStatus: Record<string, { status: 'testing' | 'success' | 'error'; message?: string }>;
    deleteStatus: Record<string, { status: 'deleting' | 'error' }>;
}

interface AddCredentialFormProps {
    onSubmit: (data: NewCredentialData) => Promise<void>; // Return promise to handle loading state
    isSaving: boolean;
    error: string | null; // Error message specific to saving
    onCancel: () => void; // Function to call when cancel is clicked
}

// --- Helper: Simple Spinner ---
const Spinner = () => (
  <svg className="animate-spin inline-block h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);


// --- Main Page Component ---
const CredentialsPage: React.FC = () => {
    // Explicitly type initial state if needed, though empty array is fine here
    const [credentials, setCredentials] = useState<Credential[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [pageError, setPageError] = useState<string | null>(null); // Errors related to fetching/deleting
    const [showAddForm, setShowAddForm] = useState<boolean>(false);
    const [testStatus, setTestStatus] = useState<Record<string, { status: 'testing' | 'success' | 'error'; message?: string }>>({});
    const [deleteStatus, setDeleteStatus] = useState<Record<string, { status: 'deleting' | 'error' }>>({});
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Fetch credentials on component mount
    const fetchCredentials = useCallback(async () => {
        setIsLoading(true);
        setPageError(null);
        try {
            const data = await getCredentialsDirectFetch(); // Use direct fetch version
            setCredentials(data);
        } catch (err: unknown) { // Use unknown
            if (err instanceof Error) {
                setPageError(err.message || 'Failed to fetch credentials.');
            } else {
                setPageError('An unknown error occurred while fetching credentials.');
            }
            setCredentials([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCredentials();
    }, [fetchCredentials]);

    // Handler for adding a new credential (Using Direct Fetch Workaround)
    const handleAddCredential = async (data: NewCredentialData): Promise<void> => {
        setIsSaving(true);
        setSaveError(null);
        try {
            if (!data.host || !data.port || !data.db_name || !data.username || !data.password) {
                throw new Error("Please fill in all required credential fields.");
            }
            // Using Direct Fetch Workaround
            console.log("Attempting save using addCredentialDirectFetch...");
            const newCredential = await addCredentialDirectFetch(data); // <-- Using direct fetch
            setCredentials(prev => [newCredential, ...prev]);
            setShowAddForm(false);
        } catch (err: unknown) { // Use unknown
             if (err instanceof Error) {
                setSaveError(err.message || 'Failed to save credential.');
             } else {
                 setSaveError('An unknown error occurred while saving.');
             }
            throw err; // Rethrow for form
        } finally {
            setIsSaving(false);
        }
    };

    // Handler for deleting a credential
    const handleDeleteCredential = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this credential? This cannot be undone.')) {
            return;
        }
        setDeleteStatus(prev => ({ ...prev, [id]: { status: 'deleting' } }));
        setPageError(null);
        try {
            await deleteCredentialDirectFetch(id); // Use direct fetch version
            setCredentials(prev => prev.filter(cred => cred.id !== id));
            setDeleteStatus(prev => {
                const newState = {...prev};
                delete newState[id];
                return newState;
            });
        } catch (err: unknown) { // Use unknown
            const errorMsg = (err instanceof Error) ? err.message : 'Failed to delete credential.';
            console.error(`Delete failed for ${id}:`, err);
            setPageError(`Failed to delete credential: ${errorMsg}`);
            setDeleteStatus(prev => ({ ...prev, [id]: { status: 'error' } }));
        }
    };

    // Handler for testing a connection
    const handleTestConnection = async (id: string) => {
        if (!id) {
           console.error("Test Connection Error: ID is missing.");
           setTestStatus(prev => ({...prev, [id || 'unknown']: { status: 'error', message: 'Internal error: ID missing'}}));
           return;
        }
        setTestStatus(prev => ({ ...prev, [id]: { status: 'testing', message: undefined } }));
        try {
            const result = await testConnectionDirectFetch(id); // Use direct fetch version
            setTestStatus(prev => ({ ...prev, [id]: { status: result.success ? 'success' : 'error', message: result.message } }));
            // Auto-clear status
            setTimeout(() => {
                setTestStatus(prev => {
                    const newState = {...prev};
                    if(newState[id]?.status === 'success' || newState[id]?.status === 'error') { delete newState[id]; }
                    return newState;
                });
            }, 7000);

        } catch (err: unknown) { // Use unknown
             const errorMsg = (err instanceof Error) ? err.message : 'Failed to run test.';
             setTestStatus(prev => ({ ...prev, [id]: { status: 'error', message: errorMsg } }));
        }
    };

    // Handler for cancelling the Add form
     const handleCancelAdd = () => {
        setShowAddForm(false);
        setSaveError(null);
     };

    // --- Render UI ---
    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <nav className="bg-white shadow-sm sticky top-0 z-10">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
                    <h1 className="text-xl font-semibold text-gray-800">Manage DB Credentials</h1>
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

                {/* Add Credential Button / Form Area */}
                <div className="mb-6 flex justify-end">
                    {!showAddForm && (
                         <button
                            onClick={() => setShowAddForm(true)}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out flex items-center"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                            Add New Credential
                        </button>
                    )}
                </div>

                {showAddForm && (
                    <div className="mb-8">
                        {/* Form component defined below */}
                        <AddCredentialForm
                            onSubmit={handleAddCredential} // Passed here
                            isSaving={isSaving}
                            error={saveError}
                            onCancel={handleCancelAdd}
                        />
                    </div>
                )}

                {/* Loading State for initial fetch */}
                {isLoading && (
                  <div className="text-center py-10">
                     {/* Spinner component defined above */}
                    <Spinner /> <span className="ml-2 text-gray-500">Loading credentials...</span>
                  </div>
                )}

                {/* Credentials List or Empty State */}
                {!isLoading && !pageError && (
                    <>
                        {credentials.length === 0 && !showAddForm ? (
                             <div className="text-center py-10 bg-white rounded-lg shadow">
                                <p className="text-gray-500">You haven't added any database credentials yet.</p>
                                <button
                                    onClick={() => setShowAddForm(true)}
                                    className="mt-4 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out"
                                >
                                    Add Your First Credential
                                </button>
                             </div>
                        ) : credentials.length > 0 ? (
                             // List component defined below
                            <CredentialList
                                credentials={credentials}
                                onDelete={handleDeleteCredential} // Passed here
                                onTest={handleTestConnection}     // Passed here
                                testStatus={testStatus}           // Passed here
                                deleteStatus={deleteStatus}       // Passed here
                             />
                        ): null /* Don't show empty message if form is open and list is empty */}
                    </>
                )}
            </main>
        </div>
    );
}; // End of CredentialsPage component


// --- Child Component: CredentialList ---

const CredentialList: React.FC<CredentialListProps> = ({
    credentials, // Used in map
    onDelete,    // Used in Delete button onClick
    onTest,      // Used in Test button onClick
    testStatus,  // Used for Test button state/display
    deleteStatus // Used for Delete button state/display
}) => {
    if (!credentials || credentials.length === 0) {
        return null; // Should be handled by parent, but safeguard
    }

    return (
        <div className="bg-white shadow-md rounded-lg overflow-x-auto">
             <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alias</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Host</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Port</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Database</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SSL</th>
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                     {/* Map uses credentials */}
                     {credentials.map((cred) => {
                         // Uses testStatus, deleteStatus
                        const currentTestStatus = testStatus[cred.id];
                        const currentDeleteStatus = deleteStatus[cred.id];
                        const isTesting = currentTestStatus?.status === 'testing';
                        const isDeleting = currentDeleteStatus?.status === 'deleting';
                        const isDisabled = isTesting || isDeleting; // Disable actions while one is in progress

                        return (
                             <tr key={cred.id} className={`transition-opacity duration-300 ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{cred.alias || <span className="text-gray-400 italic">No Alias</span>}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{cred.host}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{cred.port}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{cred.db_name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{cred.username}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 capitalize">{cred.ssl_mode || 'prefer'}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                                    {/* Test Button uses onTest, isDisabled, isTesting, currentTestStatus */}
                                     <div className="inline-flex items-center min-w-[100px]"> {/* Min width to prevent layout shifts */}
                                        <button
                                            onClick={() => !isDisabled && onTest(cred.id)} // Uses onTest
                                            disabled={isDisabled}
                                            className={`flex items-center justify-center px-2 py-1 text-xs rounded ${
                                                isTesting
                                                ? 'bg-gray-200 text-gray-500 cursor-wait'
                                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed'
                                            }`}
                                            title="Test Connection"
                                        >
                                            {isTesting && <Spinner />}
                                            <span className={isTesting ? 'ml-1.5' : ''}>{isTesting ? 'Testing...' : 'Test'}</span>
                                        </button>
                                         {/* Uses currentTestStatus */}
                                         {currentTestStatus && !isTesting && (
                                             <span
                                                className={`ml-2 text-xs font-semibold whitespace-nowrap ${currentTestStatus.status === 'success' ? 'text-green-600' : 'text-red-600'}`}
                                                title={currentTestStatus.message} // Show full message on hover
                                            >
                                                 {currentTestStatus.status === 'success' ? '✓ OK' : '✗ Failed'}
                                            </span>
                                        )}
                                    </div>

                                    {/* Delete Button uses onDelete, isDisabled, isDeleting, currentDeleteStatus */}
                                     <button
                                        onClick={() => !isDisabled && onDelete(cred.id)} // Uses onDelete
                                        disabled={isDisabled}
                                        className={`inline-flex items-center justify-center px-2 py-1 text-xs rounded ${
                                             isDeleting
                                                ? 'bg-gray-200 text-gray-500 cursor-wait'
                                                : 'bg-red-100 text-red-700 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed'
                                        }`}
                                        title="Delete Credential"
                                    >
                                         {isDeleting && <Spinner />}
                                         <span className={isDeleting ? 'ml-1.5' : ''}>{isDeleting ? 'Deleting...' : 'Delete'}</span>
                                     </button>
                                      {/* Uses currentDeleteStatus */}
                                     {currentDeleteStatus?.status === 'error' && <span className="text-xs text-red-600 font-semibold" title="Deletion failed, check page errors">Error</span> }
                                </td>
                             </tr>
                        );
                    })}
                 </tbody>
             </table>
         </div>
    );
}; // End of CredentialList Component


// --- Child Component: AddCredentialForm ---

const AddCredentialForm: React.FC<AddCredentialFormProps> = ({
    onSubmit, // Used in handleSubmit
    isSaving, // Used for disabling elements/showing spinner
    error,    // Used for displaying error message
    onCancel  // Used for Cancel button onClick
}) => {
     // Explicit initial state and type
     const initialState: NewCredentialData = {
        alias: '', host: '', port: 5432, db_name: '', username: '', password: '', ssl_mode: 'prefer'
     };
     // Explicitly type useState
     const [formData, setFormData] = useState<NewCredentialData>(initialState);

    // Uses correct event types
    const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        // Uses setFormData
        setFormData(prev => ({
            ...prev,
            [name]: name === 'port' ? (parseInt(value, 10) || 0) : value
        }));
    };

    // Uses correct event type
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        console.log("Submitting Form Data:", formData);
        if (!formData.host || !formData.port || !formData.db_name || !formData.username || !formData.password) {
            alert("Please fill in all required fields."); // Consider better validation feedback
            return;
        }
        try {
            // Uses onSubmit
            await onSubmit(formData);
        } catch (err: unknown) { // Catch unknown
            // Error is displayed by parent component via the 'error' prop
            console.error("Save failed (error handled by parent):", err);
        }
    };

    // --- Render Form JSX ---
    return (
         <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md border border-gray-200 mb-6 animate-fade-in">
             <h2 className="text-xl font-semibold text-gray-700 mb-6 border-b pb-3">Add New Database Credential</h2>
             <form onSubmit={handleSubmit} className="space-y-5">
                 {/* Display Save Error uses error prop */}
                {error && (
                  <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded" role="alert">
                    <p className="font-bold">Save Error</p>
                    <p>{error}</p>
                  </div>
                )}
                 {/* Form Grid */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                     {/* Alias Input */}
                    <div>
                        <label htmlFor="alias" className="block text-sm font-medium text-gray-700 mb-1">Alias <span className="text-gray-400">(Optional)</span></label>
                        <input type="text" name="alias" id="alias" value={formData.alias || ''} onChange={handleChange} disabled={isSaving}
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                         <p className="mt-1 text-xs text-gray-500">A nickname for this connection.</p>
                    </div>
                     {/* Host Input */}
                     <div>
                        <label htmlFor="host" className="block text-sm font-medium text-gray-700 mb-1">Host <span className="text-red-500">*</span></label>
                        <input type="text" name="host" id="host" value={formData.host} onChange={handleChange} required disabled={isSaving} placeholder="e.g., db.example.com or IP address"
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                    </div>
                     {/* Port Input */}
                    <div>
                        <label htmlFor="port" className="block text-sm font-medium text-gray-700 mb-1">Port <span className="text-red-500">*</span></label>
                        <input type="number" name="port" id="port" value={formData.port || ''} onChange={handleChange} required disabled={isSaving} min="1" max="65535"
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                    </div>
                     {/* Database Name Input */}
                    <div>
                        <label htmlFor="db_name" className="block text-sm font-medium text-gray-700 mb-1">Database Name <span className="text-red-500">*</span></label>
                        <input type="text" name="db_name" id="db_name" value={formData.db_name} onChange={handleChange} required disabled={isSaving}
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                    </div>
                     {/* Username Input */}
                     <div>
                        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">Username <span className="text-red-500">*</span></label>
                        <input type="text" name="username" id="username" value={formData.username} onChange={handleChange} required disabled={isSaving} autoComplete="off"
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                    </div>
                     {/* Password Input */}
                     <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password <span className="text-red-500">*</span></label>
                        <input type="password" name="password" id="password" value={formData.password || ''} onChange={handleChange} required disabled={isSaving} autoComplete="new-password"
                               className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"/>
                    </div>
                 </div>
                  {/* SSL Mode Row */}
                 <div className="pt-2">
                     <label htmlFor="ssl_mode" className="block text-sm font-medium text-gray-700 mb-1">SSL Mode</label>
                     <select name="ssl_mode" id="ssl_mode" value={formData.ssl_mode || 'prefer'} onChange={handleChange} disabled={isSaving}
                             className="block w-full max-w-xs pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed">
                         <option value="disable">Disable</option>
                         <option value="allow">Allow</option>
                         <option value="prefer">Prefer (Default)</option>
                         <option value="require">Require</option>
                     </select>
                 </div>
                 {/* Action Buttons */}
                 <div className="flex justify-end items-center space-x-3 pt-4">
                     {/* Cancel Button uses onCancel */}
                    <button type="button" onClick={onCancel} disabled={isSaving} className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                        Cancel
                    </button>
                     {/* Save Button uses isSaving */}
                    <button type="submit" disabled={isSaving} className="inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed min-w-[130px]">
                         {isSaving && <Spinner />}
                         <span className={isSaving ? 'ml-2' : ''}>{isSaving ? 'Saving...' : 'Save Credential'}</span>
                    </button>
                 </div>
             </form>
         </div>
    );
}; // End of AddCredentialForm Component


// Export the main page component
export default CredentialsPage;

 