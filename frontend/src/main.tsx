import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { ClerkProvider } from '@clerk/clerk-react';
import { CredentialsProvider } from './lib/credentials';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
console.log(PUBLISHABLE_KEY);


createRoot(document.getElementById('root')!).render(

  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <CredentialsProvider>
          <App />
        </CredentialsProvider>
    </ClerkProvider>
  </StrictMode>,
)
