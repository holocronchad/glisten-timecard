import { Routes, Route } from 'react-router-dom';
import Kiosk from './kiosk/Kiosk';
import ManageRoot from './manage/ManageRoot';
import Me from './me/Me';
import NotFound from './shared/NotFound';
import { ToastProvider } from './shared/toast';

export default function App() {
  return (
    <ToastProvider>
      <div className="noise-overlay" aria-hidden />
      <Routes>
        <Route path="/" element={<Kiosk />} />
        <Route path="/me" element={<Me />} />
        <Route path="/manage/*" element={<ManageRoot />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  );
}
