// src/pages/HomePage.tsx
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Simple Placeholder Icon (Replace with actual icons later if desired)
const FeatureIcon = () => (
  <svg className="w-12 h-12 text-blue-500 mb-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
);

const HomePage: React.FC = () => {
  const { session } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 flex flex-col">
      {/* Navbar */}
      <nav className="w-full bg-white/80 backdrop-blur-md sticky top-0 z-50 shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-6 py-3 flex justify-between items-center">
          <Link to="/" className="text-2xl font-bold text-blue-600">
            Helius Indexer
          </Link>
          <div className="space-x-4 flex items-center">
            {session ? (
              <Link
                to="/dashboard"
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-md shadow transition duration-300 text-sm"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-gray-600 hover:text-blue-600 font-medium text-sm"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-md shadow transition duration-300 text-sm"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-grow container mx-auto px-6 pt-16 pb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-extrabold text-gray-800 mb-4 leading-tight">
          Index Solana Data <span className="text-blue-600">Directly</span> to Postgres
        </h1>
        <p className="text-lg md:text-xl text-gray-500 mb-10 max-w-3xl mx-auto">
          Stream real-time Solana blockchain data into your own PostgreSQL database using Helius webhooks. Simple, fast, and no infrastructure hassle.
        </p>

        {!session && (
          <Link
            to="/signup"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg text-lg shadow-lg hover:shadow-xl transition duration-300 inline-block"
          >
            Get Started Now
          </Link>
        )}
      </main>

      {/* Features Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-6">
          <h2 className="text-3xl font-bold text-gray-800 mb-12 text-center">
            Why Helius Indexer?
          </h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-300">
              <FeatureIcon />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                Effortless Setup
              </h3>
              <p className="text-gray-500">
                Connect your Postgres DB, select data feeds via our UI, and start indexing in minutes.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-300">
              <FeatureIcon />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                Real-Time Speed
              </h3>
              <p className="text-gray-500">
                Leverage low-latency Helius webhooks for immediate on-chain event reflection in your database.
              </p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 hover:shadow-lg transition-shadow duration-300">
              <FeatureIcon />
              <h3 className="text-xl font-semibold text-gray-700 mb-2">
                Zero Infrastructure
              </h3>
              <p className="text-gray-500">
                No need to manage RPCs, validators, or Geyser plugins. We handle the blockchain connection complexity.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="py-16 bg-blue-50">
         <div className="container mx-auto px-6">
            <h2 className="text-3xl font-bold text-gray-800 mb-12 text-center">
                Powering Your Applications
            </h2>
            <div className="max-w-4xl mx-auto bg-white p-8 rounded-lg shadow-md">
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-gray-600">
                    <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>Track NFT floor prices & bids across marketplaces.</span>
                    </li>
                     <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>Monitor token prices from DEXs for analytics.</span>
                    </li>
                    <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>Index DeFi protocol events (loans, swaps, etc.).</span>
                    </li>
                    <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>Build custom on-chain activity dashboards & alerts.</span>
                    </li>
                     <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>Feed analytics databases for deeper insights.</span>
                    </li>
                     <li className="flex items-start space-x-3">
                        <span className="text-blue-500 mt-1">&#10004;</span>
                        <span>And much more...</span>
                    </li>
                </ul>
            </div>
         </div>
      </section>

      {/* Footer */}
      <footer className="w-full bg-gray-800 p-6 mt-auto">
        <div className="container mx-auto text-center text-gray-400 text-sm">
          &copy; {new Date().getFullYear()} Helius Indexer. Built with Supabase & Helius.
        </div>
      </footer>
    </div>
  );
};

export default HomePage;