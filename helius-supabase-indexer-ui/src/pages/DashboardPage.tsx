// src/pages/DashboardPage.tsx
import React from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { useNavigate, Link } from 'react-router-dom';

const DashboardPage: React.FC = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login'); // Redirect to login after logout
  };

  // Redirect if not logged in (though App.tsx should handle this)
  if (!session) {
    navigate('/login');
    return null; // Return null while navigating
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navbar */}
      <nav className="bg-white shadow-sm">
        <div className="container mx-auto px-6 py-3 flex justify-between items-center">
          <Link to="/dashboard" className="text-xl font-bold text-blue-600">
            Helius Indexer Dashboard
          </Link>
          <div className="flex items-center space-x-4">
            <span className="text-gray-600 text-sm hidden md:block">
              Welcome, {user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 px-4 rounded-md shadow transition duration-300"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="container mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Your Dashboard</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Placeholder Card for Credentials */}
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              Manage DB Credentials
            </h2>
            <p className="text-gray-500 mb-4">
              Securely add, view, and manage the connection details for your PostgreSQL databases.
            </p>
            <Link
  to="/dashboard/credentials"
  className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-md text-sm transition duration-300"
>
  Manage Credentials
</Link>
          </div>

          {/* Placeholder Card for Indexing Jobs */}
          <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              Manage Indexing Jobs
            </h2>
            <p className="text-gray-500 mb-4">
              Create, monitor, pause, or delete indexing jobs to stream Solana data into your databases.
            </p>
            <Link
  to="/dashboard/jobs"
  className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-md text-sm transition duration-300"
>
  Manage Jobs
</Link>
          </div>
        </div>

        {/* Add more dashboard components or summaries later */}

      </main>
    </div>
  );
};

export default DashboardPage;