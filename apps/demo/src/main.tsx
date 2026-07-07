/**
 * @packageDocumentation
 * Koyomi デモアプリのエントリポイント。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@koyomi/react/theme.css';
import './demo.css';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root 要素が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
