import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './auth';
import Login from './Login';
import ManageShell from './ManageShell';
import Today from './Today';
import Missed from './Missed';
import Period from './Period';
import Punches from './Punches';
import Staff from './Staff';
import Locations from './Locations';
import EmployeeDetail from './EmployeeDetail';

export default function ManageRoot() {
  return (
    <AuthProvider>
      <ManageRoutes />
    </AuthProvider>
  );
}

function ManageRoutes() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<ManageShell />}>
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<Today />} />
          <Route path="missed" element={<Missed />} />
          <Route path="period" element={<Period />} />
          <Route path="punches" element={<Punches />} />
          <Route path="staff" element={<Staff />} />
          <Route path="offices" element={<Locations />} />
          <Route path="employees/:id" element={<EmployeeDetail />} />
        </Route>
      </Route>
    </Routes>
  );
}

function RequireAuth() {
  const { token } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!token) nav('/manage/login', { replace: true });
  }, [token, nav]);
  if (!token) return null;
  return <Outlet />;
}
