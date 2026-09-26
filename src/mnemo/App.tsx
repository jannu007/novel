import { Routes, Route, Navigate } from 'react-router-dom';
import Desk from './pages/Desk';
import Study from './pages/Study';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Desk />} />
      <Route path="/d/:id" element={<Study />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
