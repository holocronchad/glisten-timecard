import { Routes, Route, Navigate } from 'react-router-dom';
import Kiosk from './kiosk/Kiosk';
import ManageRoot from './manage/ManageRoot';
import Me from './me/Me';

export default function App() {
  return (
    <>
      <div className="noise-overlay" aria-hidden />
      <Routes>
        <Route path="/" element={<Kiosk />} />
        <Route path="/me" element={<Me />} />
        <Route path="/manage/*" element={<ManageRoot />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
