// pages/_app.js
import '../styles/globals.css';
import { useEffect, useState } from 'react';

export default function App({ Component, pageProps }) {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
  };

  return <Component {...pageProps} theme={theme} toggleTheme={toggleTheme} />;
}
