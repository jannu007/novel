import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Characters from './pages/Characters';
import Plot from './pages/Plot';
import Export from './pages/Export';
import Guide from './pages/Guide';
import PrintPreview from './pages/PrintPreview';
import Reader from './pages/Reader';
import PageTransition from './components/PageTransition';

export default function App() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Dashboard /></PageTransition>} />
        <Route path="/novel/:id" element={<PageTransition><Editor /></PageTransition>} />
        <Route
          path="/novel/:id/characters"
          element={<PageTransition><Characters /></PageTransition>}
        />
        <Route path="/novel/:id/plot" element={<PageTransition><Plot /></PageTransition>} />
        <Route path="/novel/:id/export" element={<PageTransition><Export /></PageTransition>} />
        <Route path="/novel/:id/print" element={<PrintPreview />} />
        <Route path="/novel/:id/read" element={<Reader />} />
        <Route path="/guide" element={<PageTransition><Guide /></PageTransition>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  );
}
