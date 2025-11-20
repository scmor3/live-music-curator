import React from 'react';
/**
 * Renders a simple maintenance page for the application.
 */
const MaintenancePage: React.FC = () => {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-zinc-900 text-white">
      <div className="p-10 w-full max-w-md text-center bg-zinc-800 rounded-2xl shadow-2xl border border-amber-600/50">
        
        {/* Icon Header */}

        <h1 className="text-3xl font-bold text-amber-400 mb-4">
          Curation Engine Offline
        </h1>
        
        <p className="text-zinc-300 mb-6">
          Things are broken af right now... Working on it!
        </p>
      </div>
    </main>
  );
};

export default MaintenancePage;