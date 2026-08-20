import { Routes, Route, Navigate } from 'react-router-dom';
import Library from './pages/Library';
import Player from './pages/Player';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/b/:id" element={<Player />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
