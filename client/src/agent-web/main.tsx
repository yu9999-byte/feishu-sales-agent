import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import RoutesComponent from '../app';
import './agent.css';

const root: HTMLElement | null = document.getElementById('root');
if (root === null) {
  throw new Error('Web product root element is missing');
}

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <RoutesComponent />
    </BrowserRouter>
  </React.StrictMode>,
);
