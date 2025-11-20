"use client";

// --- START: NEW ROUTING IMPORTS ---
import { useState, useEffect } from 'react';

// Import the full working application component
import HomePage from './HomePage'; 
// Import the maintenance page
import MaintenancePage from './MaintenancePage';

// Read the public environment variable
const APP_MODE = process.env.NEXT_PUBLIC_APP_MODE;
// --- END: NEW ROUTING IMPORTS ---

// --- NEW HOME PAGE ROUTER COMPONENT ---
export default function PageRouter() {
  
  // If the mode is set to MAINTENANCE, render the maintenance page immediately
  if (APP_MODE === 'MAINTENANCE') {
    return <MaintenancePage />;
  }

  // Otherwise, render the full application.
  return <HomePage />;
}
// --- END: NEW HOME PAGE ROUTER COMPONENT ---
