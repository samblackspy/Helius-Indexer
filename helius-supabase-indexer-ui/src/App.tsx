// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import HomePage from './pages/HomePage';
import CredentialsPage from './pages/CredentialsPage'; 
import { useAuth } from './context/AuthContext';
import JobsPage from './pages/JobsPage.tsx'; 

function App() {
  const { session, loading } = useAuth();

  if (loading) {
     return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={!session ? <LoginPage /> : <Navigate to="/dashboard" />} />
      <Route path="/signup" element={!session ? <SignupPage /> : <Navigate to="/dashboard" />} />

      {/* Protected Routes */}
      <Route
         path="/dashboard"
         element={session ? <DashboardPage /> : <Navigate to="/login" />}
       />
       {/* Add new route for credentials under dashboard */}
       <Route
         path="/dashboard/credentials"
         element={session ? <CredentialsPage /> : <Navigate to="/login" />}
       />
       {/* Add new route for jobs under dashboard */}
       <Route
         path="/dashboard/jobs"
         element={session ? <JobsPage /> : <Navigate to="/login" />}
       />

      {/* Redirect unknown paths */}
      <Route path="*" element={<Navigate to={session ? "/dashboard" : "/"} />} />
    </Routes>
  );
}

export default App;