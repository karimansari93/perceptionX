import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initVitals } from './lib/vitals'
import './index.css'

initVitals();

createRoot(document.getElementById("root")!).render(<App />);
