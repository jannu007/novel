import { Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Characters from './pages/Characters';
import Plot from './pages/Plot';
import Export from './pages/Export';
import Guide from './pages/Guide';
import PrintPreview from './pages/PrintPreview';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/novel/:id" element={<Editor />} />
      <Route path="/novel/:id/characters" element={<Characters />} />
      <Route path="/novel/:id/plot" element={<Plot />} />
      <Route path="/novel/:id/export" element={<Export />} />
      <Route path="/novel/:id/print" element={<PrintPreview />} />
      <Route path="/guide" element={<Guide />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
