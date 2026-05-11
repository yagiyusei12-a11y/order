import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./layout/Shell";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Employees from "./pages/Employees";
import Vehicles from "./pages/Vehicles";
import Tariffs from "./pages/Tariffs";
import DailyReports from "./pages/DailyReports";
import DailyReportDetail from "./pages/DailyReportDetail";
import TimePunches from "./pages/TimePunches";
import Alcohol from "./pages/Alcohol";
import Payroll from "./pages/Payroll";
import PayrollRunDetail from "./pages/PayrollRunDetail";
import Documents from "./pages/Documents";
import TenantSettings from "./pages/TenantSettings";
import Rbac from "./pages/Rbac";
import Legal from "./pages/Legal";

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="employees" element={<Employees />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="tariffs" element={<Tariffs />} />
        <Route path="daily-reports" element={<DailyReports />} />
        <Route path="daily-reports/:id" element={<DailyReportDetail />} />
        <Route path="time-punches" element={<TimePunches />} />
        <Route path="alcohol" element={<Alcohol />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="payroll/:id" element={<PayrollRunDetail />} />
        <Route path="documents" element={<Documents />} />
        <Route path="settings" element={<TenantSettings />} />
        <Route path="rbac" element={<Rbac />} />
        <Route path="legal" element={<Legal />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
