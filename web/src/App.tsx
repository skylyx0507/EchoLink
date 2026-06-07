import { Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./components/Login";
import { RoomBrowser } from "./components/RoomBrowser";
import { Room } from "./components/Room";
import "./App.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("echolink-token");
  if (!token) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/rooms" element={<ProtectedRoute><RoomBrowser /></ProtectedRoute>} />
      <Route path="/room/:roomId" element={<ProtectedRoute><Room /></ProtectedRoute>} />
    </Routes>
  );
}

export default App;
