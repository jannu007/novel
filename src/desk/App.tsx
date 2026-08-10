import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Write from './pages/Write';
import Material from './pages/Material';
import Polish from './pages/Polish';
import Finish from './pages/Finish';
import Read from './pages/Read';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/w/:id" element={<Write />} />
      <Route path="/w/:id/material" element={<Material />} />
      <Route path="/w/:id/polish" element={<Polish />} />
      <Route path="/w/:id/export" element={<Finish />} />
      <Route path="/w/:id/read" element={<Read />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
